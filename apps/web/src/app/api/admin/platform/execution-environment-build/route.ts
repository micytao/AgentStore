import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { refreshEeBuild, startEeBuild } from "@/server/eeBuild";

/**
 * Starts (or re-starts) the "Build from source" action on the AAP Job
 * Templates card — builds the Execution Environment image as an
 * OpenShift BuildConfig (see ansible/execution-environment/README.md
 * "Option B") instead of requiring `ansible-builder`/`podman` locally,
 * then registers the result as an AAP Execution Environment.
 */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { name?: string; credentialId?: number };
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
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
