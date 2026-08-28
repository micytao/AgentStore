import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { refreshDeployment, startDeployment } from "@/server/deployments";

/** Starts (or re-starts) the "deploy this generic-chat agent to OpenShift"
 * AAP job. Called once when an admin clicks "Deploy to OpenShift", and
 * again for a "Redeploy" after a failure. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    return NextResponse.json(await startDeployment(id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Polls the in-flight deploy for progress — the Admin UI calls this on
 * an interval while `deployment.status === "deploying"`, the same
 * pattern used for polling Task provisioning. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    return NextResponse.json(await refreshDeployment(id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
