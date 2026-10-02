import * as ocp from "./openshift";

/**
 * AgentStore console image build — builds apps/web/Containerfile inside
 * the OpenShift cluster. Same OpenShift BuildConfig mechanism as
 * agentSandboxServiceBuild.ts and agentRuntimeBuild.ts, just with a
 * different Containerfile path and context directory.
 *
 * Same two-phase start/poll convention:
 * startAgentStoreImageBuild() triggers the Build and returns immediately;
 * getAgentStoreImageBuildResult() polls it to completion.
 */

const AGENTSTORE_BUILD_NAME = "agentstore";
const AGENTSTORE_CONTEXT_DIR = "";
const AGENTSTORE_DOCKERFILE_PATH = "apps/web/Containerfile";

export interface AgentStoreImageBuildInput {
  gitUrl: string;
  gitBranch: string;
  gitSecretName?: string;
}

export async function startAgentStoreImageBuild(
  input: AgentStoreImageBuildInput
): Promise<{ buildName: string }> {
  await ocp.findOrCreateEeImageStream(AGENTSTORE_BUILD_NAME);
  await ocp.findOrCreateEeBuildConfig({
    name: AGENTSTORE_BUILD_NAME,
    imageStreamName: AGENTSTORE_BUILD_NAME,
    gitUrl: input.gitUrl,
    gitBranch: input.gitBranch,
    contextDir: AGENTSTORE_CONTEXT_DIR,
    dockerfilePath: AGENTSTORE_DOCKERFILE_PATH,
    gitSecretName: input.gitSecretName,
  });
  return ocp.startEeBuild(AGENTSTORE_BUILD_NAME);
}

export async function getAgentStoreImageBuildPhase(buildName: string): Promise<string> {
  return (await ocp.getEeBuildStatus(buildName)).phase;
}

export interface AgentStoreImageBuildResult {
  image: string;
}

export async function getAgentStoreImageBuildResult(
  buildName: string
): Promise<AgentStoreImageBuildResult | undefined> {
  const status = await ocp.getEeBuildStatus(buildName);
  if (["New", "Pending", "Running"].includes(status.phase)) return undefined;
  if (status.phase !== "Complete") {
    throw new Error(
      `OpenShift build ${status.phase.toLowerCase()}${status.message ? ` — ${status.message}` : ""}. ` +
        `Check Build "${buildName}" logs in the OpenShift console and retry.`
    );
  }
  const image = await ocp.getEeImageReference(AGENTSTORE_BUILD_NAME);
  return { image };
}

export async function getAgentStoreImageBuildLog(buildName: string, tailLines = 1000): Promise<string> {
  return ocp.getEeBuildLogTail(buildName, tailLines);
}
