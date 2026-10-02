import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { installRhdhOperator, refreshRhdhOperator } from "@/server/rhdhDeploy";

export const dynamic = "force-dynamic";

/** Installs the RHDH operator (Namespace + OperatorGroup + Subscription). */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await installRhdhOperator());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Polls operator install status (CRD discovery). */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await refreshRhdhOperator());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
