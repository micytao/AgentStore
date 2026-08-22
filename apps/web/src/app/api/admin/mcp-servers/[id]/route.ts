import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { deleteMcpServer } from "@/server/mcp";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  await deleteMcpServer(id);
  return NextResponse.json({ ok: true });
}
