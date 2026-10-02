import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { refreshAgentStoreDeploy, startAgentStoreDeploy } from "@/server/agentstoreDeploy";

export const dynamic = "force-dynamic";

/** Starts (or re-starts) the "Deploy AgentStore to OpenShift" action. */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await startAgentStoreDeploy());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Polls the in-flight build/deploy for progress. */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await refreshAgentStoreDeploy());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
