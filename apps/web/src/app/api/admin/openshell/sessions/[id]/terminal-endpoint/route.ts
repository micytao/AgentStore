import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { mintTerminalToken } from "@agentstore/engine-openshell";
import { ensurePlatformEnv } from "@/server/platform";

/** Mints a fresh terminal WebSocket URL/token for a sandbox session.
 * Unlike the listing-scoped terminal-endpoint route, this works with
 * any session id — used by the OpenShell Sessions console tab. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    ensurePlatformEnv();
    const { id } = await context.params;
    const endpoint = await mintTerminalToken(id);
    return NextResponse.json(endpoint);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
