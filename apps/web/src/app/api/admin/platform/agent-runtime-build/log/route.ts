import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { fetchAgentRuntimeBuildLog } from "@/server/agentRuntimeBuild";

// This GET reads nothing from `request` (requireAdmin() is a no-op
// stub today), so Next.js could otherwise treat it as a static route
// and cache its response indefinitely once built for production — bad
// for a log tail that must always be fresh.
export const dynamic = "force-dynamic";

/**
 * Tail of the agent-runtime "Build from source" build's log — lets the
 * "View build log" section on the Agent Runtime card show exactly why a
 * build failed without the admin needing to open the OpenShift console.
 */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ log: await fetchAgentRuntimeBuildLog() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
