import type { OcpImageBuildStatus, PlatformSettings } from "@agentstore/shared";
import {
  ensureNamespace,
  getAgentRuntimeImageBuildLog,
  getAgentRuntimeImageBuildPhase,
  getAgentRuntimeImageBuildResult,
  isOpenshiftConfigured,
  openshiftNamespace,
  startAgentRuntimeImageBuild,
} from "@agentstore/engine-openshift";
import { ensurePlatformEnv, getPlatformSettings, savePlatformSettings } from "./platform";

/**
 * The agent-runtime "Build from source" admin action (Admin -> Platform
 * -> Agent Runtime -> "Start build"): AgentStore-side wiring around
 * packages/engine-openshift's agentRuntimeBuild.ts, following the exact
 * same two-phase start/refresh convention —
 * startAgentRuntimeBuild() kicks off an OpenShift Build and returns
 * immediately; refreshAgentRuntimeBuild() polls it and, once complete,
 * persists the built image's reference onto
 * PlatformSettings.agentRuntimeImage — this is a plain application
 * image referenced directly by the Deployment spec.
 */

function now(): string {
  return new Date().toISOString();
}

function persist(build: OcpImageBuildStatus, extra?: Partial<PlatformSettings>): PlatformSettings {
  return savePlatformSettings({ ...extra, agentRuntimeBuild: build });
}

/**
 * Starts (or re-starts) the "Build from source" OpenShift build.
 * Persists an initial "deploying" status immediately and returns; the
 * Admin UI polls refreshAgentRuntimeBuild() for progress. Needs only
 * OpenShift — no intermediate orchestrator needed.
 */
export async function startAgentRuntimeBuild(): Promise<PlatformSettings> {
  // Note: the route handler saves any draft `settings` (e.g. Project Git
  // URL/branch) via savePlatformSettings() *before* calling this, the
  // same fix applied to the EE build after it once silently started a
  // build against an empty Git URL because the draft had never been
  // saved — see startAgentRuntimeBuild()/apps/web's route handler.
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  if (!isOpenshiftConfigured()) {
    throw new Error("OpenShift is not configured — set the API URL and token in Admin → Platform.");
  }
  if (!settings.projectGitUrl?.trim()) {
    throw new Error(
      "Set a Project Git URL in Admin → Platform first — the OpenShift build uses that repo/branch."
    );
  }

  try {
    await ensureNamespace(openshiftNamespace());
    const { buildName } = await startAgentRuntimeImageBuild({
      gitUrl: settings.projectGitUrl!,
      gitBranch: settings.projectGitBranch || "main",
    });
    return persist({ status: "deploying", phase: "building", buildName, updatedAt: now() });
  } catch (err) {
    return persist({ status: "failed", error: err instanceof Error ? err.message : String(err), updatedAt: now() });
  }
}

/**
 * Polls the in-flight build (if any) and updates the persisted status.
 * A no-op that just returns the settings unchanged when there's nothing
 * in flight — safe for the Admin UI to call on an interval.
 */
export async function refreshAgentRuntimeBuild(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  const build = settings.agentRuntimeBuild;
  if (!build || build.status !== "deploying" || !build.buildName) {
    return settings;
  }

  try {
    // Peeked separately from getAgentRuntimeImageBuildResult()'s own
    // status check below purely so the progress bar has something to
    // render mid-poll — see refreshAgentRuntimeBuild() for the same
    // pattern/rationale.
    const ocpPhase = await getAgentRuntimeImageBuildPhase(build.buildName);
    const result = await getAgentRuntimeImageBuildResult(build.buildName);
    if (!result) {
      // Build is still New/Pending/Running — nothing more to do this poll.
      return persist({ ...build, phase: "building", ocpPhase, updatedAt: now() });
    }
    return persist(
      { ...build, status: "running", phase: "done", ocpPhase, image: result.image, updatedAt: now() },
      { agentRuntimeImage: result.image }
    );
  } catch (err) {
    return persist({
      ...build,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      updatedAt: now(),
    });
  }
}

/**
 * Tail of the current/most recent build's log — the "View build log"
 * section polls this so an admin can see exactly why a build failed
 * without leaving AgentStore for the OpenShift console.
 */
export async function fetchAgentRuntimeBuildLog(): Promise<string> {
  ensurePlatformEnv();
  const build = getPlatformSettings().agentRuntimeBuild;
  if (!build?.buildName) return "(no build started yet)";
  return getAgentRuntimeImageBuildLog(build.buildName);
}
