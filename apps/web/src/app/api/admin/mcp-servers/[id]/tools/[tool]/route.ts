import { NextResponse } from "next/server";
import { setToolEnabled } from "@/server/mcp";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; tool: string }> }
) {
  const { id, tool } = await context.params;
  const { enabled } = (await request.json()) as { enabled?: boolean };
  try {
    return NextResponse.json(
      setToolEnabled(id, decodeURIComponent(tool), Boolean(enabled))
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    );
  }
}
