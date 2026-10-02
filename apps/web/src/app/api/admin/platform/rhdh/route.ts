import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { getRhdhPreflight } from "@/server/rhdhDeploy";

export const dynamic = "force-dynamic";

/** Returns RHDH preflight check results + current deploy status. */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getRhdhPreflight());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
