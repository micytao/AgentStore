import { NextResponse } from "next/server";
import { setMcpAuthToken } from "@/server/mcp";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { value } = (await request.json()) as { value?: string };
  if (!value) {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(setMcpAuthToken(id, value));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    );
  }
}
