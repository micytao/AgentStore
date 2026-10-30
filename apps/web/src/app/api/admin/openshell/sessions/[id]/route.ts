import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { getSession, deleteSession } from "@agentstore/engine-openshell";
import { ensurePlatformEnv } from "@/server/platform";

/** Fetches the current state of a single session by id. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    ensurePlatformEnv();
    const { id } = await context.params;
    const session = await getSession(id);
    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Deletes (tears down) a sandbox session by id. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    ensurePlatformEnv();
    const { id } = await context.params;
    await deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
