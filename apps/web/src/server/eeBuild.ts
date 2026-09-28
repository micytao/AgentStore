import type { EeBuildStatus, PlatformSettings } from "@agentstore/shared";
import {
  getEeImageBuildLog,
  getEeImageBuildPhase,
  getEeImageBuildResult,
  isAapConfigured,
  isOpenshiftConfigured,
  startEeImageBuild,
  type EeImageBuildInput,
} from "@agentstore/engine-ansible";
import { ensurePlatformEnv, getPlatformSettings, savePlatformSettings } from "./platform";

/**
 * The "Build from source" admin action (Admin -> Platform -> AAP Job
 * Templates -> "+ Build from source"): AgentStore-side wiring around
 * packages/engine-ansible's eeBuild.ts, following the exact same
 * two-phase start/refresh convention as aapBootstrap.ts —
 * startEeBuild() kicks off an OpenShift Build and returns immediately;
 * refreshEeBuild() polls it and, once complete, registers the built
 * image as an AAP Execution Environment. Both persist progress onto
 * PlatformSettings.eeBuild so the Admin UI can poll this the same way it
 * already polls aapBootstrap.
 */

function now(): string {
  return new Date().toISOString();
}

function persist(build: EeBuildStatus, extra?: Partial<PlatformSettings>): PlatformSettings {
  return savePlatformSettings({ ...extra, eeBuild: build });
}

/** Builds the eeBuild.ts input from persisted settings + this call's
 * ephemeral (not persisted as top-level settings) name/credential
 * choice — reuses the same Git URL/branch already configured for the
 * AAP Project, since that repo also contains
 * ansible/execution-environment/Containerfile. */
function buildInputFrom(
  settings: PlatformSettings,
  name: string,
  credentialId?: number
): EeImageBuildInput {
  if (!settings.aapProjectGitUrl.trim()) {
    throw new Error(
      "Set a Project Git URL above first — the OpenShift build uses the same repo/branch as the AAP Project."
    );
  }
  return {
    gitUrl: settings.aapProjectGitUrl,
    gitBranch: settings.aapProjectGitBranch || "main",
    executionEnvironmentName: name,
    registryCredentialId: credentialId,
  };
}

/**
 * Starts (or re-starts) the "Build from source" OpenShift build.
 * Persists an initial "deploying" EeBuildStatus immediately and returns;
 * the Admin UI polls refreshEeBuild() for progress.
 */
export async function startEeBuild(input: { name: string; credentialId?: number }): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  if (!isOpenshiftConfigured()) {
    throw new Error("OpenShift is not configured — set the API URL and token in Admin → Platform.");
  }
  if (!isAapConfigured()) {
    throw new Error("AAP is not configured — set the controller URL and token in Admin → Platform.");
  }
  if (!input.name.trim()) {
    throw new Error("Name is required to register the built image in AAP.");
  }

  try {
    const buildInput = buildInputFrom(settings, input.name.trim(), input.credentialId);
    const { buildName } = await startEeImageBuild(buildInput);
    return persist({
      status: "deploying",
      phase: "building",
      buildName,
      executionEnvironmentName: input.name.trim(),
      registryCredentialId: input.credentialId,
      updatedAt: now(),
    });
  } catch (err) {
    return persist({ status: "failed", error: err instanceof Error ? err.message : String(err), updatedAt: now() });
  }
}

/**
 * Polls the in-flight build (if any) and updates the persisted
 * EeBuildStatus. A no-op that just returns the settings unchanged when
 * there's nothing in flight — safe for the Admin UI to call on an
 * interval, same pattern as aapBootstrap.ts's refreshBootstrap().
 */
export async function refreshEeBuild(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  const build = settings.eeBuild;
  if (!build || build.status !== "deploying" || !build.buildName) {
    return settings;
  }

  try {
    // Peeked separately from getEeImageBuildResult()'s own status check
    // below purely so the "Build from source" mini-form's progress bar
    // has something to render even mid-poll — a second cheap GET on the
    // same Build object, not worth folding into one call.
    const ocpPhase = await getEeImageBuildPhase(build.buildName);
    const buildInput = buildInputFrom(
      settings,
      build.executionEnvironmentName ?? "AgentStore execution environment",
      build.registryCredentialId
    );
    const result = await getEeImageBuildResult(build.buildName, buildInput);
    if (!result) {
      // Build is still New/Pending/Running — nothing more to do this poll.
      return persist({ ...build, phase: "building", ocpPhase, updatedAt: now() });
    }
    return persist(
      {
        ...build,
        status: "running",
        phase: "done",
        ocpPhase,
        image: result.image,
        executionEnvironmentId: result.executionEnvironmentId,
        updatedAt: now(),
      },
      { aapExecutionEnvironmentId: result.executionEnvironmentId }
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
 * section on the "Build from source" mini-form polls this so an admin
 * can see exactly why a build failed without leaving AgentStore for the
 * OpenShift console. Returns a friendly message instead of throwing
 * when there's no build to show a log for yet.
 */
export async function fetchEeBuildLog(): Promise<string> {
  ensurePlatformEnv();
  const build = getPlatformSettings().eeBuild;
  if (!build?.buildName) return "(no build started yet)";
  return getEeImageBuildLog(build.buildName);
}
