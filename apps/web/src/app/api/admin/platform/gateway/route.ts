import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { refreshGatewayDeployment, startGatewayDeployment } from "@/server/gateway";

/** Starts (or re-starts) the "install the OpenShell gateway" AAP job.
 * Mirrors apps/web/src/app/api/admin/listings/[id]/deploy/route.ts, just
 * platform-scoped instead of per-listing. */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await startGatewayDeployment());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Polls the in-flight gateway install for progress — the Admin UI calls
 * this on an interval while `openshellGatewayDeployment.status ===
 * "deploying"`. */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await refreshGatewayDeployment());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
