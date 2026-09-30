import type { OpenShellMcpServerConfig, OpenShellModelConfig } from "@agentstore/shared";
import { SdkError } from "@nvidia/openshell-sdk";
import { defaultSandboxImage } from "./config.js";
import { buildOpenCodeConfig, isNativeProvider, nativeProviderEnvVar } from "./opencodeConfig.js";
import { getClient } from "./openshellClient.js";

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

/** Queries the OpenShell gateway for a sandbox we don't have in memory
 * (e.g. after a service restart) and re-populates the in-memory map.
 * Returns the recovered record, or undefined if the gateway doesn't
 * know about it either. */
async function recoverFromGateway(id: string): Promise<SessionRecord | undefined> {
  try {
    const client = await getClient();
    const ref = await client.sandbox.get(id);
    const { phase, message } = mapPhase(ref.phase);
    const record: SessionRecord = {
      id,
      agent: "(recovered after restart)",
      phase,
      message,
      createdAt: Date.now(),
    };
    sessionStore().set(id, record);
    console.log(`[sessions] recovered sandbox ${id} from gateway (phase: ${ref.phase} → ${phase})`);
    return record;
  } catch (err) {
    if (err instanceof SdkError && err.code === "not_found") {
      return undefined;
    }
    console.error(`[sessions] failed to recover sandbox ${id} from gateway:`, err);
    return undefined;
  }
}

/** Async session lookup that falls back to the gateway if the session
 * isn't in the in-memory map — handles service restarts transparently. */
export async function getOrRecoverSession(id: string): Promise<SessionRecord | undefined> {
  return sessionStore().get(id) ?? recoverFromGateway(id);
}

function sandboxNameFor(taskId: string): string {
  return `as-${taskId.replace(/-/g, "").slice(0, 12)}`;
}

/** Registers (or reuses) an OpenShell "provider" carrying a native
 * provider's API key, so `sandbox create --provider <name>` attaches the
 * credential without it ever passing through `--env`. Uses the raw gRPC
 * escape hatch since provider CRUD is not yet curated in the SDK. */
async function ensureNativeProviderRegistered(kind: string, apiKey: string): Promise<string> {
  const providerName = `agentstore-${kind}`;
  const envVar = nativeProviderEnvVar(kind);
  const client = await getClient();
  try {
    await client.raw.createProvider({
      workspaceScope: { selection: { case: "workspace", value: "default" } },
      provider: {
        metadata: { name: providerName },
        type: kind,
        credentials: envVar ? { [envVar]: apiKey } : {},
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/exists|already/i.test(message)) {
      throw new Error(`Failed to register OpenShell provider ${providerName}: ${message}`);
    }
  }
  return providerName;
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
    const client = await getClient();
    const config = buildOpenCodeConfig(input.model, input.mcpServers);

    const providerNames: string[] = [];
    if (input.model && isNativeProvider(input.model.kind) && input.model.apiKey) {
      const providerName = await ensureNativeProviderRegistered(input.model.kind, input.model.apiKey);
      providerNames.push(providerName);
    }

    // Create sandbox with the agent command directly. Terminal access
    // uses execInteractive to spawn a separate shell session alongside
    // the running agent — no tmux needed.
    await client.sandbox.create({
      name: id,
      image: defaultSandboxImage(),
      providers: providerNames,
      command: ["sh", "-c", input.agent],
      tty: true,
      restartPolicy: "on-failure",
    });

    // Wait for the sandbox to become ready before uploading config.
    await client.sandbox.waitReady(id, 120);

    // Upload the opencode config via exec + stdin (replaces CLI --upload).
    const configJson = JSON.stringify(config, null, 2);
    await client.sandbox.exec(id, ["sh", "-c", "mkdir -p .config/opencode && cat > .config/opencode/opencode.json"], {
      stdin: Buffer.from(configJson),
    });

    // Optionally clone a git repo into the sandbox.
    if (input.gitUrl) {
      await client.sandbox.exec(id, ["git", "clone", withEmbeddedToken(input.gitUrl, input.gitToken), "/workspace"]).catch((err) => {
        record.message = `Sandbox created but git clone failed: ${err instanceof Error ? err.message : String(err)}`;
      });
    }

    record.phase = "Running";
    return record;
  } catch (err) {
    record.phase = "Failed";
    record.message = err instanceof Error ? err.message : String(err);
    return record;
  }
}

/** Maps the SDK's SandboxPhaseName to our SessionPhase. */
function mapPhase(sdkPhase: string): { phase: SessionPhase; message?: string } {
  switch (sdkPhase) {
    case "provisioning":
    case "starting":
      return { phase: "Provisioning" };
    case "error":
      return { phase: "Failed", message: sdkPhase };
    case "deleting":
    case "stopped":
    case "completed":
      return { phase: "Cancelled" };
    case "ready":
    default:
      return { phase: "Running" };
  }
}

export async function refreshSession(id: string): Promise<SessionRecord | undefined> {
  let record = sessionStore().get(id);
  if (!record) {
    // Not in memory — try recovering from the gateway (handles restarts).
    record = await recoverFromGateway(id);
    if (!record) return undefined;
  }
  if (record.phase === "Failed" || record.phase === "Cancelled") return record;

  try {
    const client = await getClient();
    const ref = await client.sandbox.get(id);
    const { phase, message } = mapPhase(ref.phase);
    record.phase = phase;
    record.message = message;
  } catch (err) {
    if (err instanceof SdkError && err.code === "not_found") {
      record.phase = "Cancelled";
      record.message = "Sandbox no longer exists";
    } else {
      record.phase = "Failed";
      record.message = err instanceof Error ? err.message : String(err);
    }
  }
  return record;
}

export async function deleteSession(id: string): Promise<void> {
  const record = sessionStore().get(id);
  if (record) {
    record.phase = "Cancelled";
  }
  try {
    const client = await getClient();
    await client.sandbox.delete(id, { allowMissing: true });
  } catch {
    // Best-effort — sandbox may already be gone.
  }
}
