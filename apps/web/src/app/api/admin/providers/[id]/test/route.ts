import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { testProvider } from "@/server/providers";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    return NextResponse.json(await testProvider(id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    );
  }
}
