import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { deleteSkill } from "@/server/skills";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  deleteSkill(id);
  return NextResponse.json({ ok: true });
}
