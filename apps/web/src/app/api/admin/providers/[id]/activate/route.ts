import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { setActiveProvider } from "@/server/providers";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    return NextResponse.json(setActiveProvider(id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    );
  }
}
