import { NextResponse } from "next/server";
import type { PlatformSettings } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { refreshBootstrap, startBootstrap } from "@/server/aapBootstrap";
import { savePlatformSettings } from "@/server/platform";

/**
 * Starts (or re-starts) the "Create job templates" AAP bootstrap.
 * Accepts an optional `settings` patch in the body so the Admin UI can
 * save its draft AAP Job Template inputs (org/project/Git URL/branch/SCM
 * credential/execution environment) in the same request that kicks off
 * the bootstrap — PlatformPanel has no separate "Save" button; this
 * follows the same save-as-a-side-effect convention as
 * /api/admin/platform/test.
 */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { settings?: Partial<PlatformSettings> };
  if (body.settings) savePlatformSettings(body.settings);
  try {
    return NextResponse.json(await startBootstrap());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Polls the in-flight bootstrap for progress — the Admin UI calls this
 * on an interval while `aapBootstrap.status === "deploying"`. */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await refreshBootstrap());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
