import * as ocp from "./openshift";
import { openshiftNamespace } from "./config";

/**
 * The agent-runtime image's "Build from source" admin action (Admin ->
 * Platform -> Agent Runtime -> "Start build"): builds
 * apps/agent-runtime/Containerfile inside the OpenShift cluster itself
 * via an OpenShift BuildConfig.
 *
 * Same two-phase start/poll convention: startAgentRuntimeImageBuild()
 * triggers the Build and returns immediately;
 * getAgentRuntimeImageBuildResult() polls it to completion (returning
 * undefined while still New/Pending/Running).
 */

const BUILD_LOG_TAIL_LINES = 1000;

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
/** All builds run in the same namespace as agent workloads — supports
 * single-namespace deployments on shared clusters. */
function buildNamespace(): string {
  return openshiftNamespace();
}

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
  await ocp.findOrCreateEeImageStream(AGENT_RUNTIME_BUILD_NAME, buildNamespace());
  await ocp.findOrCreateEeBuildConfig({
    name: AGENT_RUNTIME_BUILD_NAME,
    imageStreamName: AGENT_RUNTIME_BUILD_NAME,
    gitUrl: input.gitUrl,
    gitBranch: input.gitBranch,
    contextDir: AGENT_RUNTIME_CONTEXT_DIR,
    dockerfilePath: AGENT_RUNTIME_DOCKERFILE_PATH,
    gitSecretName: input.gitSecretName,
  }, buildNamespace());
  return ocp.startEeBuild(AGENT_RUNTIME_BUILD_NAME, buildNamespace());
}

/** Just the raw OpenShift Build phase, for the "Build from source"
 * mini-form's progress bar — see eeBuild.ts's getEeImageBuildPhase()
 * for the same rationale. */
export async function getAgentRuntimeImageBuildPhase(buildName: string): Promise<string> {
  return (await ocp.getEeBuildStatus(buildName, buildNamespace())).phase;
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
  const status = await ocp.getEeBuildStatus(buildName, buildNamespace());
  if (["New", "Pending", "Running"].includes(status.phase)) return undefined;
  if (status.phase !== "Complete") {
    throw new Error(
      `OpenShift build ${status.phase.toLowerCase()}${status.message ? ` — ${status.message}` : ""}. ` +
        `Check Build "${buildName}" logs in the OpenShift console and retry.`
    );
  }
  const image = await ocp.getEeImageReference(AGENT_RUNTIME_BUILD_NAME, "latest", buildNamespace());
  return { image };
}

/** Tail of the Build's log, for the "View build log" section — see
 * eeBuild.ts's getEeImageBuildLog() for the same rationale. */
export async function getAgentRuntimeImageBuildLog(
  buildName: string,
  tailLines = BUILD_LOG_TAIL_LINES
): Promise<string> {
  return ocp.getEeBuildLogTail(buildName, tailLines, buildNamespace());
}
