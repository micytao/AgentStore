import { NextResponse } from "next/server";
import { testProvider } from "@/server/providers";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
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
