import { NextResponse } from "next/server";
import { getInteractiveEndpoint } from "@/server/orchestrator";

/** Mints a fresh terminal token/URL on every call rather than caching one
 * on the task — LiveTerminal.tsx calls this once when it mounts. For the
 * "openshell" kind, exposeInteractiveEndpoint() calls the Agent Sandbox
 * Service's POST /sessions/:id/terminal-token, so the signed token (the
 * real access-control boundary for that directly browser-reachable
 * WebSocket) is only ever handed to an already-authenticated console
 * session, and only just before it's needed. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const endpoint = await getInteractiveEndpoint(id);
    if (!endpoint) {
      return NextResponse.json({ error: "No interactive endpoint for this task" }, { status: 404 });
    }
    return NextResponse.json(endpoint);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
