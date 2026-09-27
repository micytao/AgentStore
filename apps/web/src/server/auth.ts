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
