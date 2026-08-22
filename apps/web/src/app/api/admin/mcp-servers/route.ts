import { NextResponse } from "next/server";
import type { McpServerConfig } from "@agentstore/shared";
import { listMcpServers, upsertMcpServer } from "@/server/mcp";

export async function GET() {
  return NextResponse.json(listMcpServers());
}

export async function POST(request: Request) {
  const body = (await request.json()) as McpServerConfig;
  if (!body.id || !body.name || !body.transport) {
    return NextResponse.json(
      { error: "id, name, and transport are required" },
      { status: 400 }
    );
  }
  return NextResponse.json(upsertMcpServer(body));
}
