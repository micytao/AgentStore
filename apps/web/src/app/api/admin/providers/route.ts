import { NextResponse } from "next/server";
import type { ProviderConfig } from "@agentstore/shared";
import { listProviders, upsertProvider } from "@/server/providers";

export async function GET() {
  return NextResponse.json(listProviders());
}

export async function POST(request: Request) {
  const body = (await request.json()) as ProviderConfig;
  if (!body.id || !body.kind || !body.label) {
    return NextResponse.json(
      { error: "id, kind, and label are required" },
      { status: 400 }
    );
  }
  return NextResponse.json(upsertProvider(body));
}
