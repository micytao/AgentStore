/**
 * This package is a thin REST client for the Agent Sandbox Service — no
 * `execFile`, no CLI, no `node-pty`, no file uploads on the console side.
 * The old `OpenShellEngineAdapter` (which wrapped these calls behind the
 * per-Task `EngineAdapter` interface) was retired along with `Task` itself
 * — apps/web/src/server/openshellDeploy.ts now calls `createSession`/
 * `getSession`/`deleteSession`/`mintTerminalToken` directly, keyed by a
 * listing id instead of a per-launch task id. The REST client itself
 * (client.ts) needed no changes for that move.
 */
export {
  createSession,
  deleteSession,
  getSession,
  mintTerminalToken,
  pingOpenShellService,
  type CreateSessionRequest,
  type RemoteSession,
} from "./client";
export { isOpenShellServiceConfigured, applyOpenShellServiceEnv, openshellServiceUrl } from "./config";
