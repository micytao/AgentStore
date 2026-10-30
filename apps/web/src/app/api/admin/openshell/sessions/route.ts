import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { listSessions } from "@agentstore/engine-openshell";
import { ensurePlatformEnv } from "@/server/platform";

/** Lists all sandbox sessions known to the Agent Sandbox Service.
 * Merges in-memory sessions with live sandboxes from the gateway. */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    ensurePlatformEnv();
    const sessions = await listSessions();
    return NextResponse.json(sessions);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
