import { NextResponse } from "next/server";
import type { EngineSettings } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { getEngineSettings, setEngineSettings } from "@/server/engines";

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  return NextResponse.json(getEngineSettings());
}

export async function PATCH(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const patch = (await request.json()) as Partial<EngineSettings>;
  return NextResponse.json(setEngineSettings(patch));
}
