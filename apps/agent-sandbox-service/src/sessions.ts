import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenShellMcpServerConfig, OpenShellModelConfig } from "@agentstore/shared";
import { extraCreateArgs } from "./config";
import { buildOpenCodeConfig, isNativeProvider, nativeProviderEnvVar } from "./opencodeConfig";
import { parseJsonOutput, runOpenshell } from "./openshellCli";

export type SessionPhase = "Provisioning" | "Running" | "Failed" | "Cancelled";

export interface SessionRecord {
  id: string;
  agent: string;
  phase: SessionPhase;
  message?: string;
  createdAt: number;
}

export interface CreateSessionInput {
  taskId: string;
  agent: string;
  model?: OpenShellModelConfig;
  mcpServers?: OpenShellMcpServerConfig[];
  gitUrl?: string;
  gitToken?: string;
}

function sessionStore(): Map<string, SessionRecord> {
  const g = globalThis as typeof globalThis & { __agentSandboxSessions?: Map<string, SessionRecord> };
  if (!g.__agentSandboxSessions) g.__agentSandboxSessions = new Map();
  return g.__agentSandboxSessions;
}

export function getSession(id: string): SessionRecord | undefined {
  return sessionStore().get(id);
}

function sandboxNameFor(taskId: string): string {
  return `as-${taskId.replace(/-/g, "").slice(0, 12)}`;
}

/** Registers (or reuses) an OpenShell "provider" carrying a native
 * provider's API key, so `sandbox create --provider <name>` attaches the
 * credential without it ever passing through `--env` (OpenShell's docs
 * explicitly warn against that). Exact flag shape is per the plan's Stage
 * B1 CLI spike — adjust here if the real CLI differs. */
async function ensureNativeProviderRegistered(kind: string, apiKey: string): Promise<string> {
  const providerName = `agentstore-${kind}`;
  const envVar = nativeProviderEnvVar(kind);
  try {
    await runOpenshell(
      ["provider", "create", "--name", providerName, "--type", kind, "--from-existing"],
      { env: envVar ? { [envVar]: apiKey } : {} }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/exists|already/i.test(message)) {
      throw new Error(`Failed to register OpenShell provider ${providerName}: ${message}`);
    }
  }
  return providerName;
}

async function writeTempConfig(sessionId: string, config: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-"));
  const file = path.join(dir, `${sessionId}.json`);
  await fs.writeFile(file, JSON.stringify(config, null, 2), "utf8");
  return file;
}

function withEmbeddedToken(gitUrl: string, gitToken?: string): string {
  if (!gitToken) return gitUrl;
  try {
    const url = new URL(gitUrl);
    if (url.protocol !== "https:") return gitUrl;
    url.username = "oauth2";
    url.password = gitToken;
    return url.toString();
  } catch {
    return gitUrl;
  }
}

export async function createSession(input: CreateSessionInput): Promise<SessionRecord> {
  const id = sandboxNameFor(input.taskId);
  const record: SessionRecord = { id, agent: input.agent, phase: "Provisioning", createdAt: Date.now() };
  sessionStore().set(id, record);

  try {
    const config = buildOpenCodeConfig(input.model, input.mcpServers);
    const configFile = await writeTempConfig(id, config);

    const providerArgs: string[] = [];
    if (input.model && isNativeProvider(input.model.kind) && input.model.apiKey) {
      const providerName = await ensureNativeProviderRegistered(input.model.kind, input.model.apiKey);
      providerArgs.push("--provider", providerName);
    }

    // We key the session store by the --name we chose (id), not whatever
    // id OpenShell's `--output json` result reports, so getSession() stays
    // predictable for the console regardless of the CLI's own id scheme.
    await runOpenshell([
      "sandbox",
      "create",
      "--name",
      id,
      "--detach",
      "--output",
      "json",
      "--upload",
      `${configFile}:.config/opencode/opencode.json`,
      ...providerArgs,
      ...extraCreateArgs(),
      "--",
      input.agent,
    ]);

    if (input.gitUrl) {
      await runOpenshell([
        "sandbox",
        "exec",
        "--name",
        id,
        "--",
        "git",
        "clone",
        withEmbeddedToken(input.gitUrl, input.gitToken),
        "/workspace",
      ]).catch((err) => {
        record.message = `Sandbox created but git clone failed: ${err instanceof Error ? err.message : String(err)}`;
      });
    }

    // `--detach` returns as soon as creation is kicked off, not once the
    // sandbox is actually ready — leave phase as "Provisioning" here and
    // let refreshSession()'s real `sandbox get` query (polled by the
    // console) advance it to "Running" once it truly is.
    return record;
  } catch (err) {
    record.phase = "Failed";
    record.message = err instanceof Error ? err.message : String(err);
    return record;
  }
}

/** Best-effort phase mapping — OpenShell's real `sandbox get --output json`
 * field names are pending confirmation against a live install (plan's
 * Stage B1 spike); this recognizes the field/value spellings most likely
 * per NVIDIA's published docs and falls back to treating "found and no
 * error" as Running. */
function mapPhase(raw: Record<string, unknown> | undefined): { phase: SessionPhase; message?: string } {
  if (!raw) return { phase: "Running" };
  const value = String(raw.phase ?? raw.status ?? raw.state ?? "").toLowerCase();
  if (["pending", "provisioning", "creating", "starting"].includes(value)) {
    return { phase: "Provisioning" };
  }
  if (["failed", "error", "crashloopbackoff"].includes(value)) {
    return { phase: "Failed", message: value };
  }
  if (["deleted", "terminated", "stopped", "cancelled", "canceled"].includes(value)) {
    return { phase: "Cancelled" };
  }
  return { phase: "Running" };
}

export async function refreshSession(id: string): Promise<SessionRecord | undefined> {
  const record = sessionStore().get(id);
  if (!record) return undefined;
  if (record.phase === "Failed" || record.phase === "Cancelled") return record;

  try {
    const output = await runOpenshell(["sandbox", "get", id, "--output", "json"]);
    const parsed = parseJsonOutput<Record<string, unknown>>(output);
    const { phase, message } = mapPhase(parsed);
    record.phase = phase;
    record.message = message;
  } catch (err) {
    record.phase = "Failed";
    record.message = err instanceof Error ? err.message : String(err);
  }
  return record;
}

export async function deleteSession(id: string): Promise<void> {
  const record = sessionStore().get(id);
  if (record) {
    record.phase = "Cancelled";
  }
  try {
    await runOpenshell(["sandbox", "delete", id]);
  } catch {
    await runOpenshell(["sandbox", "rm", id]).catch(() => undefined);
  }
}
