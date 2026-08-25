/**
 * Environment for the Agent Sandbox Service itself. This is a separate env
 * surface from the console's (packages/engine-ansible/src/config.ts,
 * packages/engine-openshell/src/config.ts) — this process runs in its own
 * pod, with its own openshell CLI identity, independent of anything the
 * console has configured.
 */

export function port(): number {
  const raw = process.env.PORT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 8090;
}

/** Bearer token the console must present on every /sessions* request. */
export function serviceToken(): string {
  return process.env.OPENSHELL_SERVICE_TOKEN ?? "";
}

/** HMAC key for signing short-lived terminal tokens. Falls back to the
 * service token itself so a minimal deployment only needs to set one
 * secret, but a dedicated value is recommended in production. */
export function terminalTokenSecret(): string {
  return process.env.TERMINAL_TOKEN_SECRET || serviceToken();
}

export function terminalTokenTtlMs(): number {
  const raw = process.env.TERMINAL_TOKEN_TTL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5 * 60_000;
}

/** No sockets attached to a pty for this long -> kill it. Protects against
 * an abandoned browser tab leaking a pty forever. */
export function terminalIdleTimeoutMs(): number {
  const raw = process.env.TERMINAL_IDLE_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30 * 60_000;
}

/** Extra args appended to every `sandbox create`, e.g. a specific driver
 * flag your cluster's OpenShell install needs. Kept as an env escape hatch
 * rather than new API surface, same spirit as the old engine-openshell's
 * OPENSHELL_CREATE_ARGS. */
export function extraCreateArgs(): string[] {
  return process.env.OPENSHELL_CREATE_ARGS?.split(" ").filter(Boolean) ?? [];
}

/** Scheme used when building the terminal WebSocket URL returned to the
 * console (and from there, straight to the browser). Defaults to "wss"
 * because the real deployment (Stage B1) is behind a TLS-terminating
 * OpenShift Route; override to "ws" only for a local plaintext test. The
 * hostname itself comes from the inbound request's Host header, not an
 * env var, so it always matches whatever Route the browser actually used. */
export function terminalPublicProtocol(): "ws" | "wss" {
  return process.env.TERMINAL_PUBLIC_PROTOCOL === "ws" ? "ws" : "wss";
}
