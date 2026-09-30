import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { checkAgentSandboxStatus, installAgentSandboxController } from "@/server/agentSandbox";

/** Live "installed/missing" check for the OpenShell tab's Agent Sandbox
 * controller preflight — cheap enough to poll on an interval right
 * after an install click (see the gateway route's GET for the same
 * polling convention, just synchronous here since there's no in-flight
 * job to track). */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await checkAgentSandboxStatus());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Applies the vendored Agent Sandbox controller manifest via the
 * OpenShift API. Mirrors apps/web/src/app/api/admin/platform/gateway/route.ts's
 * POST, just synchronous (no AAP job to launch) — see
 * apps/web/src/server/agentSandbox.ts for why. */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await installAgentSandboxController());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
