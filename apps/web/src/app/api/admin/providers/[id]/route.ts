import { NextResponse } from "next/server";
import { deleteProvider } from "@/server/providers";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  deleteProvider(id);
  return NextResponse.json({ ok: true });
}
