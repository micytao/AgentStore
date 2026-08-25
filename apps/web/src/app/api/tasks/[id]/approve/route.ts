import { NextResponse } from "next/server";
import { currentRole } from "@/server/auth";
import { decideTask } from "@/server/orchestrator";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const role = currentRole(request);
    return NextResponse.json(await decideTask(id, "approved", role));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
