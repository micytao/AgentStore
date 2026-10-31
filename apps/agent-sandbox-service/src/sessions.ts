import type { OpenShellMcpServerConfig, OpenShellModelConfig } from "@agentstore/shared";
import { openshellCommandForAgent } from "@agentstore/shared";
import { SdkError } from "@nvidia/openshell-sdk";
import { sandboxImageForAgent } from "./config.js";
import { buildOpenCodeConfig, isNativeProvider, nativeProviderEnvVar } from "./opencodeConfig.js";
import { getClient } from "./openshellClient.js";

/**
 * Baseline sandbox policy attached at create-time. The supervisor fetches this
 * via gRPC to learn the isolation boundary — without it sandboxes like OpenClaw
 * never become "ready" because the supervisor can't discover a policy.
 */
const DEFAULT_SANDBOX_POLICY = {
  version: 1,
  filesystem: {
    includeWorkdir: true,
    readOnly: ["/bin", "/usr", "/lib", "/proc", "/dev/urandom", "/etc", "/var/log"],
    readWrite: ["/tmp", "/dev/null"],
  },
  landlock: { compatibility: "best_effort" },
};

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
  /** Override the auto-resolved sandbox image for this session. */
  sandboxImage?: string;
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

/** Returns all known sessions — merges the in-memory store with live
 * sandbox state from the gateway so that sandboxes created outside
 * AgentStore (e.g. via the `openshell` CLI) or surviving a service
 * restart are included. */
export async function listSessions(): Promise<SessionRecord[]> {
  const store = sessionStore();

  // Fetch live sandboxes from the gateway via the raw gRPC client.
  // The protobuf response nests fields: sandbox.metadata.name,
  // sandbox.metadata.labels, sandbox.status.phase (numeric enum),
  // sandbox.metadata.createdTime.seconds (bigint string).
  try {
    const client = await getClient();
    const response = await client.raw.listSandboxes({
      workspaceScope: { selection: { case: "workspace", value: "default" } },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const sb of (response as any).sandboxes ?? []) {
      const meta = sb.metadata ?? sb;
      const status = sb.status ?? {};
      const name: string = meta.name ?? meta.id ?? "";
      if (!name || store.has(name)) continue;

      // status.phase is a numeric enum in protobuf: 0=unknown, 1=provisioning, 2=ready, 3=error, etc.
      const rawPhase = typeof status.phase === "number" ? numericPhaseToString(status.phase) : String(status.phase ?? "unknown");
      const { phase, message } = mapPhase(rawPhase);

      // Extract creation time — protobuf Timestamp has seconds as bigint/string.
      const createdSecs = meta.createdTime?.seconds;
      const createdAt = createdSecs ? Number(createdSecs) * 1000 : Date.now();

      // Derive agent name from the sandbox command if possible.
      const command: string[] = sb.spec?.command ?? [];
      const agentFromCommand = deriveAgentFromCommand(command);
      const agentFromLabels = (meta.labels ?? {})["agentstore.agent"];

      store.set(name, {
        id: name,
        agent: agentFromLabels ?? agentFromCommand ?? "(unknown)",
        phase,
        message,
        createdAt,
      });
    }
  } catch (err) {
    console.error("[sessions] failed to list sandboxes from gateway:", err);
  }

  // Refresh phase for each session that's still in a live state.
  const records = [...store.values()];
  const refreshed: SessionRecord[] = [];
  for (const rec of records) {
    if (rec.phase === "Provisioning" || rec.phase === "Running") {
      try {
        const client = await getClient();
        const ref = await client.sandbox.get(rec.id);
        const { phase, message } = mapPhase(ref.phase);
        rec.phase = phase;
        rec.message = message;
      } catch (err) {
        if (err instanceof SdkError && err.code === "not_found") {
          rec.phase = "Cancelled";
          rec.message = "Sandbox no longer exists";
        }
      }
    }
    refreshed.push(rec);
  }
  return refreshed;
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
    //
    // A policy is required so the supervisor can discover it via gRPC.
    // Without one the supervisor loops on "Server returned no policy".
    // Extracted to a variable because the SDK declares `policy?:
    // MessageInitShape<…>` but the installed @bufbuild/protobuf does
    // not export MessageInitShape — collapsing the field to `never`
    // and triggering excess-property errors on object literals.
    const sandboxSpec = {
      name: id,
      image: sandboxImageForAgent(input.agent, input.sandboxImage),
      providers: providerNames,
      command: openshellCommandForAgent(input.agent),
      tty: true,
      policy: DEFAULT_SANDBOX_POLICY,
    };
    await client.sandbox.create(sandboxSpec as Parameters<typeof client.sandbox.create>[0]);

    // Wait for the sandbox to become ready before uploading config.
    // 300s to cover first-time image pulls + supervisor bootstrap on
    // cold clusters (the supervisor alone can take ~3 min on first run).
    await client.sandbox.waitReady(id, 300);

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

/** Maps the protobuf numeric phase enum to a string name.
 * Values from openshell.v1.SandboxPhase: 0=UNKNOWN, 1=PROVISIONING,
 * 2=READY, 3=ERROR, 4=DELETING, 5=STOPPED, 6=COMPLETED, 7=STARTING. */
function numericPhaseToString(n: number): string {
  switch (n) {
    case 1: return "provisioning";
    case 2: return "ready";
    case 3: return "error";
    case 4: return "deleting";
    case 5: return "stopped";
    case 6: return "completed";
    case 7: return "starting";
    default: return "unknown";
  }
}

/** Best-effort: derive a human-readable agent name from the sandbox command.
 * e.g. ["openclaw-start"] → "openclaw", ["sh","-c","opencode"] → "opencode" */
function deriveAgentFromCommand(command: string[]): string | undefined {
  if (!command.length) return undefined;
  const last = command[command.length - 1];
  if (last.startsWith("openclaw")) return "openclaw";
  if (last.includes("opencode")) return "opencode";
  if (last.includes("swebench")) return "swebench";
  return last.replace(/-start$/, "");
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
  // Remove from in-memory store immediately so it doesn't reappear on the next listSessions() poll.
  sessionStore().delete(id);
  try {
    const client = await getClient();
    await client.sandbox.delete(id, { allowMissing: true });
  } catch {
    // Best-effort — sandbox may already be gone.
  }
}
