import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { syncStateToCluster } from "@/server/agentstoreDeploy";

export const dynamic = "force-dynamic";

/** Pushes local state to the on-cluster AgentStore instance. */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const result = await syncStateToCluster();
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
