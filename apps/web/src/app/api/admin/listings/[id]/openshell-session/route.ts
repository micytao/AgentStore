import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import {
  refreshOpenShellSession,
  startOpenShellSession,
  stopOpenShellSession,
} from "@/server/openshellDeploy";

/** Starts (or re-starts) this listing's persistent OpenShell sandbox
 * session. Called once when an admin clicks "Deploy", and again for a
 * "Redeploy" after a failure. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    return NextResponse.json(await startOpenShellSession(id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Polls the in-flight session for progress — the Admin UI calls this on
 * an interval while `openshellSession.status === "deploying"`. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    return NextResponse.json(await refreshOpenShellSession(id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Tears down this listing's sandbox session. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    return NextResponse.json(await stopOpenShellSession(id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
