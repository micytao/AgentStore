import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { provisionRhdhInstance, refreshRhdhInstance } from "@/server/rhdhDeploy";

export const dynamic = "force-dynamic";

/** Provisions ConfigMaps + Secret + Backstage CR in the rhdh namespace. */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      namespace?: string;
      agentstoreUrl?: string;
    };
    return NextResponse.json(await provisionRhdhInstance(body));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Polls instance status (Route available + Deployment ready). */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await refreshRhdhInstance());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
