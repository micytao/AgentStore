import type { EngineAdapter, EngineHandle, EngineStatus, TaskSpec } from "@agentstore/shared";
import * as client from "./client";

/**
 * Real OpenShell adapter — a thin REST client against the in-cluster Agent
 * Sandbox Service (apps/agent-sandbox-service). No `execFile`, no CLI, no
 * `node-pty`, no file uploads on the console side: the console only ever
 * resolves *what* to run (model/MCP/repo, already put on TaskSpec by
 * orchestrator.ts's specFrom()) and hands that off as plain JSON.
 *
 * engines.ts only routes here when isOpenShellServiceConfigured() is true
 * (mirroring how ansibleEngine's simulated fallback lives in
 * createAnsibleEngine, not here) — engine-fake covers the simulated path
 * for OpenShell listings, so this adapter has no simulated branch of its
 * own.
 */

function phaseFrom(remote: client.RemoteSession["phase"]): EngineStatus["phase"] {
  switch (remote) {
    case "Provisioning":
      return "Provisioning";
    case "Running":
      return "Running";
    case "Failed":
      return "Failed";
    case "Cancelled":
      return "Cancelled";
  }
}

export class OpenShellEngineAdapter implements EngineAdapter {
  async provision(spec: TaskSpec): Promise<EngineHandle> {
    const agent = spec.openshellAgent ?? "opencode";
    const session = await client.createSession({
      taskId: spec.taskId,
      agent,
      model: spec.openshellModel,
      mcpServers: spec.openshellMcpServers,
      gitUrl: spec.gitUrl,
      gitToken: spec.gitToken,
    });
    if (session.phase === "Failed") {
      throw new Error(session.message || "Agent Sandbox Service failed to create the session");
    }
    return {
      engineType: "self-hosted-sandbox",
      sandboxId: session.id,
      backend: "openshell",
    };
  }

  async getStatus(handle: EngineHandle): Promise<EngineStatus> {
    try {
      const session = await client.getSession(handle.sandboxId);
      const phase = phaseFrom(session.phase);
      if (phase === "Running") {
        return { phase, backend: "openshell", interactive: { kind: "openshell" } };
      }
      if (phase === "Failed") {
        return { phase, backend: "openshell", outputSummary: session.message };
      }
      return { phase, backend: "openshell", provisioningStep: session.message };
    } catch (err) {
      return {
        phase: "Failed",
        backend: "openshell",
        outputSummary: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async exposeInteractiveEndpoint(handle: EngineHandle) {
    const { url } = await client.mintTerminalToken(handle.sandboxId);
    return { kind: "openshell" as const, url };
  }

  async terminate(handle: EngineHandle): Promise<void> {
    await client.deleteSession(handle.sandboxId);
  }
}

export const openShellEngine = new OpenShellEngineAdapter();

export { isOpenShellServiceConfigured, applyOpenShellServiceEnv, openshellServiceUrl } from "./config";
export { pingOpenShellService } from "./client";
