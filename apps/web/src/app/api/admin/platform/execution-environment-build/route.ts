import { NextResponse } from "next/server";
import type { PlatformSettings } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { refreshEeBuild, startEeBuild } from "@/server/eeBuild";
import { savePlatformSettings } from "@/server/platform";

/**
 * Starts (or re-starts) the "Build from source" action on the AAP Job
 * Templates card — builds the Execution Environment image as an
 * OpenShift BuildConfig (see ansible/execution-environment/README.md
 * "Option B") instead of requiring `ansible-builder`/`podman` locally,
 * then registers the result as an AAP Execution Environment.
 *
 * Accepts an optional `settings` patch in the body (the Project Git
 * URL/branch this build reads) so the Admin UI can save its draft in
 * the same request that kicks off the build, even if the admin never
 * separately clicked "Create job templates" — same save-as-a-
 * side-effect convention as /api/admin/platform/job-templates and
 * /api/admin/platform/test.
 */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    credentialId?: number;
    settings?: Partial<PlatformSettings>;
  };
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (body.settings) savePlatformSettings(body.settings);
  try {
    return NextResponse.json(await startEeBuild({ name: body.name, credentialId: body.credentialId }));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Polls the in-flight build for progress — the Admin UI calls this on
 * an interval while `eeBuild.status === "deploying"`. */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await refreshEeBuild());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
