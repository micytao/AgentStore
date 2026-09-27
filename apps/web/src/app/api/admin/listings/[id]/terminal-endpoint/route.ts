import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { getOpenShellTerminalEndpoint } from "@/server/openshellDeploy";

/** Mints a fresh terminal token/URL on every call rather than caching one
 * on the listing — LiveTerminal.tsx calls this once when it mounts. Since
 * this mints a signed token for a directly browser-reachable WebSocket,
 * it's only ever handed out from an already-authenticated admin request,
 * and only just before it's needed. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const endpoint = await getOpenShellTerminalEndpoint(id);
    if (!endpoint) {
      return NextResponse.json({ error: "No live sandbox session for this listing" }, { status: 404 });
    }
    return NextResponse.json(endpoint);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
