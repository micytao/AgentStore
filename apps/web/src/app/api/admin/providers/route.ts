import { NextResponse } from "next/server";
import type { ProviderConfig } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { listProviders, upsertProvider } from "@/server/providers";

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  return NextResponse.json(listProviders());
}

export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = (await request.json()) as ProviderConfig;
  if (!body.id || !body.kind || !body.label) {
    return NextResponse.json(
      { error: "id, kind, and label are required" },
      { status: 400 }
    );
  }
  return NextResponse.json(upsertProvider(body));
}
