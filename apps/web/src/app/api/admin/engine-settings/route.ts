import { NextResponse } from "next/server";
import type { EngineSettings } from "@agentstore/shared";
import { getEngineSettings, setEngineSettings } from "@/server/engines";

export async function GET() {
  return NextResponse.json(getEngineSettings());
}

export async function PATCH(request: Request) {
  const patch = (await request.json()) as Partial<EngineSettings>;
  return NextResponse.json(setEngineSettings(patch));
}
