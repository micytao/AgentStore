import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { refreshAgentSandboxServiceInstall, startAgentSandboxServiceInstall } from "@/server/agentSandbox";

// GET reads nothing from `request` either — see the matching comment in
// apps/web/src/app/api/admin/platform/agent-runtime-build/log/route.ts
// for why this needs to stay fully dynamic.
export const dynamic = "force-dynamic";

/**
 * Starts (or re-starts) the "Install Agent Sandbox Service" action —
 * builds apps/agent-sandbox-service/Containerfile as an OpenShift
 * BuildConfig, then (once refreshAgentSandboxServiceInstall() below
 * polls it to completion) deploys deploy/openshift/agent-sandbox-service.yaml
 * with that image and auto-fills PlatformSettings.openshellServiceUrl +
 * the OPENSHELL_SERVICE_TOKEN secret. Reuses the same Project Git URL/
 * branch already saved on the Platform tab — no body/draft-settings
 * needed here, unlike the EE/Agent Runtime build routes (this button
 * lives on the OpenShell tab, which has no draft of that field itself).
 */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await startAgentSandboxServiceInstall());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Polls the in-flight build/install for progress — the Admin UI calls
 * this on an interval while `agentSandboxServiceInstall.status ===
 * "deploying"`. */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await refreshAgentSandboxServiceInstall());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
