import { EE_BUILD_LOG_TAIL_LINES } from "@agentstore/shared";
import * as ocp from "./openshift";

/**
 * The agent-runtime image's "Build from source" admin action (Admin ->
 * Platform -> Agent Runtime -> "Start build"): builds
 * apps/agent-runtime/Containerfile inside the OpenShift cluster itself,
 * triggered from AgentStore — the same OpenShift BuildConfig mechanism
 * eeBuild.ts uses for the AAP Execution Environment image, just with a
 * different Containerfile/context and no AAP-registration step (this is
 * a plain application container, not an Ansible Execution Environment —
 * genericAgentDeploy.ts's launchGenericAgentDeploy() references the
 * built image's reference directly).
 *
 * Unlike the EE build, this needs no AAP Project/Credential at all —
 * only OpenShift. It reuses the same Git URL/branch already configured
 * for the AAP Project (PlatformSettings.aapProjectGitUrl/
 * aapProjectGitBranch) purely because that's the one Git source
 * AgentStore already has on hand, not because AAP is otherwise
 * involved.
 *
 * Same two-phase start/poll convention as eeBuild.ts: startAgentRuntime
 * ImageBuild() triggers the Build and returns immediately;
 * getAgentRuntimeImageBuildResult() polls it to completion (returning
 * undefined while still New/Pending/Running).
 */

/** Single shared BuildConfig/ImageStream name — there's only ever one
 * agent-runtime image, reused across every generic-chat listing (see
 * apps/agent-runtime/README.md). */
const AGENT_RUNTIME_BUILD_NAME = "agentstore-agent-runtime";
/** Empty string = repository root as the build context — required
 * here (unlike the EE's own subdirectory) because the Containerfile's
 * COPY instructions (package.json, apps/agent-runtime, packages/) are
 * all repo-root-relative, needing the whole monorepo as build context
 * to resolve @agentstore/shared and @agentstore/agent-core. */
const AGENT_RUNTIME_CONTEXT_DIR = "";
const AGENT_RUNTIME_DOCKERFILE_PATH = "apps/agent-runtime/Containerfile";

export interface AgentRuntimeImageBuildInput {
  /** Any repo/branch containing apps/agent-runtime/Containerfile at
   * that path — in practice the same one already configured for the
   * AAP Project. */
  gitUrl: string;
  gitBranch: string;
  gitSecretName?: string;
}

/** Phase 1: finds-or-creates the ImageStream+BuildConfig and triggers a
 * new Build. Safe to call again later (e.g. after a failed build, or
 * after changing the Git URL/branch) — every OpenShift object here is
 * idempotent by name. */
export async function startAgentRuntimeImageBuild(
  input: AgentRuntimeImageBuildInput
): Promise<{ buildName: string }> {
  await ocp.findOrCreateEeImageStream(AGENT_RUNTIME_BUILD_NAME);
  await ocp.findOrCreateEeBuildConfig({
    name: AGENT_RUNTIME_BUILD_NAME,
    imageStreamName: AGENT_RUNTIME_BUILD_NAME,
    gitUrl: input.gitUrl,
    gitBranch: input.gitBranch,
    contextDir: AGENT_RUNTIME_CONTEXT_DIR,
    dockerfilePath: AGENT_RUNTIME_DOCKERFILE_PATH,
    gitSecretName: input.gitSecretName,
  });
  return ocp.startEeBuild(AGENT_RUNTIME_BUILD_NAME);
}

/** Just the raw OpenShift Build phase, for the "Build from source"
 * mini-form's progress bar — see eeBuild.ts's getEeImageBuildPhase()
 * for the same rationale. */
export async function getAgentRuntimeImageBuildPhase(buildName: string): Promise<string> {
  return (await ocp.getEeBuildStatus(buildName)).phase;
}

export interface AgentRuntimeImageBuildResult {
  image: string;
}

/** Phase 2: polls the Build from phase 1; returns undefined while it's
 * still New/Pending/Running (the caller should try again shortly). Once
 * it's Complete, just reads back the built image's pullable reference —
 * no AAP registration step, unlike getEeImageBuildResult(). */
export async function getAgentRuntimeImageBuildResult(
  buildName: string
): Promise<AgentRuntimeImageBuildResult | undefined> {
  const status = await ocp.getEeBuildStatus(buildName);
  if (["New", "Pending", "Running"].includes(status.phase)) return undefined;
  if (status.phase !== "Complete") {
    throw new Error(
      `OpenShift build ${status.phase.toLowerCase()}${status.message ? ` — ${status.message}` : ""}. ` +
        `Check Build "${buildName}" logs in the OpenShift console and retry.`
    );
  }
  const image = await ocp.getEeImageReference(AGENT_RUNTIME_BUILD_NAME);
  return { image };
}

/** Tail of the Build's log, for the "View build log" section — see
 * eeBuild.ts's getEeImageBuildLog() for the same rationale. */
export async function getAgentRuntimeImageBuildLog(
  buildName: string,
  tailLines = EE_BUILD_LOG_TAIL_LINES
): Promise<string> {
  return ocp.getEeBuildLogTail(buildName, tailLines);
}
