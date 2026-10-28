import * as ocp from "./openshift";
import { openshiftNamespace } from "./config";

/**
 * Execution Environment image build — builds
 * ansible/execution-environment/Containerfile inside the OpenShift cluster
 * via a BuildConfig (Docker strategy). The OpenShift BuildConfig/ImageStream
 * primitives are reused by other build files (agentRuntimeBuild.ts,
 * agentSandboxServiceBuild.ts, agentstoreImageBuild.ts).
 *
 * Same two-phase start/poll convention: startEeImageBuild() triggers the
 * Build and returns immediately; getEeImageBuildResult() polls it to
 * completion (returning undefined while still New/Pending/Running) and
 * returns the built image reference.
 */

/** Single shared BuildConfig/ImageStream name — matches the "exactly two
 * shared Job Templates, not per-listing" convention the rest of this
 * bootstrap uses; there's only ever one Execution Environment image. */
const EE_BUILD_NAME = "agentstore-ee";
const EE_CONTEXT_DIR = "ansible/execution-environment";
const EE_DOCKERFILE_PATH = "Containerfile";
const BUILD_LOG_TAIL_LINES = 1000;
/** All builds run in the same namespace as agent workloads — supports
 * single-namespace deployments on shared clusters. */
function buildNamespace(): string {
  return openshiftNamespace();
}

export interface EeImageBuildInput {
  /** Must contain ansible/execution-environment/Containerfile at that path. */
  gitUrl: string;
  gitBranch: string;
  gitSecretName?: string;
}

/** Phase 1: finds-or-creates the ImageStream+BuildConfig and triggers a
 * new Build. Safe to call again later (e.g. after a failed build, or
 * after changing the Git URL/branch) — every OpenShift object here is
 * idempotent by name. */
export async function startEeImageBuild(input: EeImageBuildInput): Promise<{ buildName: string }> {
  await ocp.findOrCreateEeImageStream(EE_BUILD_NAME, buildNamespace());
  await ocp.findOrCreateEeBuildConfig({
    name: EE_BUILD_NAME,
    imageStreamName: EE_BUILD_NAME,
    gitUrl: input.gitUrl,
    gitBranch: input.gitBranch,
    contextDir: EE_CONTEXT_DIR,
    dockerfilePath: EE_DOCKERFILE_PATH,
    gitSecretName: input.gitSecretName,
  }, buildNamespace());
  return ocp.startEeBuild(EE_BUILD_NAME, buildNamespace());
}

export interface EeImageBuildResult {
  image: string;
}

/** Just the raw OpenShift Build phase ("New" | "Pending" | "Running" |
 * "Complete" | "Failed" | "Error" | "Cancelled"), for the "Build from
 * source" mini-form's progress bar — a coarser signal than a real
 * percentage (OpenShift doesn't expose one), but still more informative
 * than a single static "building…" label. */
export async function getEeImageBuildPhase(buildName: string): Promise<string> {
  return (await ocp.getEeBuildStatus(buildName, buildNamespace())).phase;
}

/** Phase 2: polls the Build from phase 1; returns undefined while it's
 * still New/Pending/Running (the caller should try again shortly). Once
 * it's Complete, reads back the built image's pullable reference from
 * the ImageStreamTag. */
export async function getEeImageBuildResult(
  buildName: string
): Promise<EeImageBuildResult | undefined> {
  const status = await ocp.getEeBuildStatus(buildName, buildNamespace());
  if (["New", "Pending", "Running"].includes(status.phase)) return undefined;
  if (status.phase !== "Complete") {
    throw new Error(
      `OpenShift build ${status.phase.toLowerCase()}${status.message ? ` — ${status.message}` : ""}. ` +
        `Check Build "${buildName}" logs in the OpenShift console and retry.`
    );
  }
  const image = await ocp.getEeImageReference(EE_BUILD_NAME, "latest", buildNamespace());
  return { image };
}

/** Tail of the Build's log, for the "View build log" section on the
 * "Build from source" mini-form — lets an admin see exactly why a build
 * failed (e.g. the openssl/get-helm-3 error this was added to
 * diagnose) without leaving AgentStore for the OpenShift console. */
export async function getEeImageBuildLog(
  buildName: string,
  tailLines = BUILD_LOG_TAIL_LINES
): Promise<string> {
  return ocp.getEeBuildLogTail(buildName, tailLines, buildNamespace());
}
