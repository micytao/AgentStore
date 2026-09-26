import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { RED_HAT_SKILL_PACKS, importRedHatSkillPacks } from "@/server/skillsImport";

/** Live counterpart to `npm run import-redhat-skills` — pulls one or more
 * Red Hat Agentic Skill Packs from GitHub and writes them into
 * catalog/skills/<pack>/, then invalidates the in-memory skills cache so
 * they show up in the Skills tab on the next load. Body: `{ packs?:
 * string[] }`, defaults to all packs. */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  let packs: string[] = [...RED_HAT_SKILL_PACKS];
  try {
    const body = (await request.json()) as { packs?: string[] };
    if (Array.isArray(body.packs) && body.packs.length > 0) packs = body.packs;
  } catch {
    // no body / invalid JSON -> fall back to importing every pack
  }
  try {
    const result = await importRedHatSkillPacks(packs);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
