import { NextResponse } from "next/server";
import { deleteMcpServer } from "@/server/mcp";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  await deleteMcpServer(id);
  return NextResponse.json({ ok: true });
}
