import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { getEngineSettings } from "@/server/engines";

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  return NextResponse.json(getEngineSettings());
}
