import { NextResponse } from "next/server";
import { setActiveProvider } from "@/server/providers";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
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
