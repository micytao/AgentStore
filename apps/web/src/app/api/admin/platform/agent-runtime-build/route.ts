import { NextResponse } from "next/server";
import type { PlatformSettings } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { refreshAgentRuntimeBuild, startAgentRuntimeBuild } from "@/server/agentRuntimeBuild";
import { savePlatformSettings } from "@/server/platform";

// GET reads nothing from `request` either — see the matching comment
// in ./log/route.ts for why this needs to stay fully dynamic.
export const dynamic = "force-dynamic";

/**
 * Starts (or re-starts) the Agent Runtime card's "Build from source"
 * action — builds apps/agent-runtime/Containerfile as an OpenShift
 * BuildConfig, then persists the built image's reference onto
 * PlatformSettings.agentRuntimeImage (no AAP-registration step, unlike
 * the Execution Environment build — see
 * /api/admin/platform/execution-environment-build for that one).
 *
 * Accepts an optional `settings` patch in the body (the Project Git
 * URL/branch this build reads) so the Admin UI can save its draft in
 * the same request that kicks off the build — same save-as-a-
 * side-effect convention as the EE build route.
 */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { settings?: Partial<PlatformSettings> };
  if (body.settings) savePlatformSettings(body.settings);
  try {
    return NextResponse.json(await startAgentRuntimeBuild());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Polls the in-flight build for progress — the Admin UI calls this on
 * an interval while `agentRuntimeBuild.status === "deploying"`. */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await refreshAgentRuntimeBuild());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
