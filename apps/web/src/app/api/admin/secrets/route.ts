import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { listSecretSummaries } from "@/server/secrets";

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  return NextResponse.json(listSecretSummaries());
}
