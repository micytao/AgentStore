import { NextResponse } from "next/server";
import type { PlatformSettings } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { savePlatformSettings, testPlatformTarget, type PlatformTestTarget } from "@/server/platform";

export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = (await request.json()) as {
    target?: PlatformTestTarget;
    settings?: Partial<PlatformSettings>;
  };
  if (body.target !== "aap" && body.target !== "openshift") {
    return NextResponse.json({ error: "target must be aap or openshift" }, { status: 400 });
  }
  if (body.settings) savePlatformSettings(body.settings);
  return NextResponse.json(await testPlatformTarget(body.target));
}
