import { NextResponse } from "next/server";
import type { Skill } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { listSkills, upsertSkill } from "@/server/skills";

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  return NextResponse.json(listSkills());
}

export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = (await request.json()) as Skill;
  if (!body.id || !body.name || !body.instructions) {
    return NextResponse.json(
      { error: "id, name, and instructions are required" },
      { status: 400 }
    );
  }
  try {
    return NextResponse.json(upsertSkill(body));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
