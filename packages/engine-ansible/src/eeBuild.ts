import { findOrCreateExecutionEnvironment } from "./aap";
import * as ocp from "./openshift";

/**
 * The "Build from source" admin action (Admin -> Platform -> AAP Job
 * Templates -> "+ Build from source"): builds the Execution Environment
 * image AAP's two Job Templates need *inside the OpenShift cluster*
 * itself, triggered from AgentStore — as an alternative to the
 * `ansible-builder`/`podman build`/`podman push` local workflow
 * documented in ansible/execution-environment/README.md, which is still
 * the only option for admins whose OpenShift cluster isn't reachable
 * from wherever AAP's execution nodes pull images from.
 *
 * There's no way to do this "inside AAP" — AAP's controller API has no
 * endpoint to build a container image, only to register one that
 * already exists in a registry (findOrCreateExecutionEnvironment(),
 * below). OpenShift's BuildConfig primitive is the closest thing
 * AgentStore already has direct API access to, so this drives that
 * instead: a BuildConfig (Docker strategy) builds
 * ansible/execution-environment/Containerfile from the *same* Git
 * source (`aapProjectGitUrl`/`aapProjectGitBranch`) already configured
 * for the AAP Project above, and pushes the result to an ImageStream in
 * OpenShift's internal registry — then the built image's pullable
 * reference is registered as an AAP Execution Environment, same as the
 * manual "Register a new image" action.
 *
 * Same two-phase start/poll convention as jobTemplateBootstrap.ts: a
 * Build can take a few minutes (pulling the base image, installing
 * collections/pip packages, installing helm), so startEeImageBuild()
 * triggers it and returns immediately, and getEeImageBuildResult() polls
 * it to completion (returning undefined while still New/Pending/
 * Running) before registering the image in AAP.
 */

/** Single shared BuildConfig/ImageStream name — matches the "exactly two
 * shared Job Templates, not per-listing" convention the rest of this
 * bootstrap uses; there's only ever one Execution Environment image. */
const EE_BUILD_NAME = "agentstore-ee";
const EE_CONTEXT_DIR = "ansible/execution-environment";
const EE_DOCKERFILE_PATH = "Containerfile";

export interface EeImageBuildInput {
  /** Same repo/branch as the AAP Project — must contain
   * ansible/execution-environment/Containerfile at that path. */
  gitUrl: string;
  gitBranch: string;
  gitSecretName?: string;
  /** AAP Execution Environment object name to register the built image
   * under once the Build completes. */
  executionEnvironmentName: string;
  /** Container Registry (kind "registry") AAP credential id — only
   * needed if AAP's execution nodes can't pull from OpenShift's internal
   * registry without one (e.g. they run outside this cluster). Omit if
   * AAP runs on/near this cluster with its default pull access. */
  registryCredentialId?: number;
}

/** Phase 1: finds-or-creates the ImageStream+BuildConfig and triggers a
 * new Build. Safe to call again later (e.g. after a failed build, or
 * after changing the Git URL/branch) — every OpenShift object here is
 * idempotent by name. */
export async function startEeImageBuild(input: EeImageBuildInput): Promise<{ buildName: string }> {
  await ocp.findOrCreateEeImageStream(EE_BUILD_NAME);
  await ocp.findOrCreateEeBuildConfig({
    name: EE_BUILD_NAME,
    imageStreamName: EE_BUILD_NAME,
    gitUrl: input.gitUrl,
    gitBranch: input.gitBranch,
    contextDir: EE_CONTEXT_DIR,
    dockerfilePath: EE_DOCKERFILE_PATH,
    gitSecretName: input.gitSecretName,
  });
  return ocp.startEeBuild(EE_BUILD_NAME);
}

export interface EeImageBuildResult {
  image: string;
  executionEnvironmentId: number;
}

/** Just the raw OpenShift Build phase ("New" | "Pending" | "Running" |
 * "Complete" | "Failed" | "Error" | "Cancelled"), for the "Build from
 * source" mini-form's progress bar — a coarser signal than a real
 * percentage (OpenShift doesn't expose one), but still more informative
 * than a single static "building…" label. */
export async function getEeImageBuildPhase(buildName: string): Promise<string> {
  return (await ocp.getEeBuildStatus(buildName)).phase;
}

/** Phase 2: polls the Build from phase 1; returns undefined while it's
 * still New/Pending/Running (the caller should try again shortly). Once
 * it's Complete, reads back the built image's pullable reference from
 * the ImageStreamTag and registers it as an AAP Execution Environment. */
export async function getEeImageBuildResult(
  buildName: string,
  input: EeImageBuildInput
): Promise<EeImageBuildResult | undefined> {
  const status = await ocp.getEeBuildStatus(buildName);
  if (["New", "Pending", "Running"].includes(status.phase)) return undefined;
  if (status.phase !== "Complete") {
    throw new Error(
      `OpenShift build ${status.phase.toLowerCase()}${status.message ? ` — ${status.message}` : ""}. ` +
        `Check Build "${buildName}" logs in the OpenShift console and retry.`
    );
  }
  const image = await ocp.getEeImageReference(EE_BUILD_NAME);
  const ee = await findOrCreateExecutionEnvironment({
    name: input.executionEnvironmentName,
    image,
    credentialId: input.registryCredentialId,
  });
  return { image, executionEnvironmentId: ee.id };
}

/** Tail of the Build's log, for the "View build log" section on the
 * "Build from source" mini-form — lets an admin see exactly why a build
 * failed (e.g. the openssl/get-helm-3 error this was added to
 * diagnose) without leaving AgentStore for the OpenShift console. */
export async function getEeImageBuildLog(buildName: string, tailLines = 1000): Promise<string> {
  return ocp.getEeBuildLogTail(buildName, tailLines);
}
