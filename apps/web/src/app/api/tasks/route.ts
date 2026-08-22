import { NextResponse } from "next/server";
import type { AgentMode, TaskTarget } from "@agentstore/shared";
import { createTask, listTasks } from "@/server/orchestrator";

export async function GET() {
  return NextResponse.json(await listTasks());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      listingId?: string;
      mode?: AgentMode;
      gitUrl?: string;
      target?: TaskTarget;
    };
    if (!body.listingId || !body.mode) {
      return NextResponse.json(
        { error: "listingId and mode are required" },
        { status: 400 }
      );
    }
    const task = await createTask({
      listingId: body.listingId,
      mode: body.mode,
      gitUrl: body.gitUrl,
      target: body.target,
    });
    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
