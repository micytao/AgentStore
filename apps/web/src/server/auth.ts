import { NextResponse } from "next/server";

/**
 * AgentStore is an admin-only console — there is no end-user role to gate
 * against anymore. When this app is deployed to OpenShift, cluster auth
 * (SSO/OIDC in front of the Route, RBAC, etc.) is what actually restricts
 * who can reach it; see docs/DEFERRED.md.
 *
 * requireAdmin() is kept as a permanent no-op (always allows the request)
 * purely so every existing /api/admin/** route can keep its
 * `const denied = requireAdmin(request); if (denied) return denied;` guard
 * unchanged — it just never denies anymore.
 */
export function requireAdmin(_request: Request): NextResponse | null {
  return null;
}

/**
 * Validates the X-AgentStore-Token header for service-to-service calls
 * (e.g. from the Red Hat Developer Hub proxy).  Returns null when the
 * token matches AGENTSTORE_SERVICE_TOKEN, or a 401 NextResponse otherwise.
 *
 * Unlike requireAdmin() this is **not** a no-op — it is only used on the
 * RHDH-facing routes that are exposed without a browser session (e.g.
 * /api/rhdh/catalog-sync).  If AGENTSTORE_SERVICE_TOKEN is unset the
 * check is skipped (open access, same as the rest of the demo).
 */
export function requireServiceToken(request: Request): NextResponse | null {
  const expected = process.env.AGENTSTORE_SERVICE_TOKEN;
  if (!expected) return null; // not configured → open access (demo mode)

  const provided = request.headers.get("x-agentstore-token");
  if (provided === expected) return null;

  return NextResponse.json(
    { error: "Missing or invalid X-AgentStore-Token header" },
    { status: 401 }
  );
}
