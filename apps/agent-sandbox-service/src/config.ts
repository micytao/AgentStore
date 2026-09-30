/**
 * Environment for the Agent Sandbox Service. This process runs in its own pod,
 * with its own connection to the OpenShell gateway (via the SDK, not the CLI).
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

/** No sockets attached to a terminal session for this long -> tear it down. */
export function terminalIdleTimeoutMs(): number {
  const raw = process.env.TERMINAL_IDLE_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30 * 60_000;
}

/** Scheme used when building the terminal WebSocket URL returned to the
 * console. Defaults to "wss" because the real deployment is behind a
 * TLS-terminating OpenShift Route. */
export function terminalPublicProtocol(): "ws" | "wss" {
  return process.env.TERMINAL_PUBLIC_PROTOCOL === "ws" ? "ws" : "wss";
}

// ---- OpenShell gateway connection ------------------------------------------

/** In-cluster gateway URL, e.g. "http://openshell-gateway.openshell:8080".
 * Required — the service cannot function without it. */
export function gatewayUrl(): string {
  const url = process.env.OPENSHELL_GATEWAY_URL;
  if (!url) throw new Error("OPENSHELL_GATEWAY_URL is required");
  return url;
}

/** Optional OIDC issuer for client-credentials auth against the gateway.
 * When all three OIDC env vars (issuer, client ID, client secret) are set,
 * the SDK uses a renewable client-credentials grant. When unset (eval-mode
 * gateway with TLS disabled), the SDK connects without auth. */
export function oidcIssuer(): string | undefined {
  return process.env.OPENSHELL_OIDC_ISSUER || undefined;
}
export function oidcClientId(): string | undefined {
  return process.env.OPENSHELL_OIDC_CLIENT_ID || undefined;
}
export function oidcClientSecret(): string | undefined {
  return process.env.OPENSHELL_OIDC_CLIENT_SECRET || undefined;
}

/** Default sandbox image when no agent-specific image is configured. */
export function defaultSandboxImage(): string {
  return process.env.OPENSHELL_DEFAULT_SANDBOX_IMAGE || "ghcr.io/anomalyco/opencode:latest";
}
