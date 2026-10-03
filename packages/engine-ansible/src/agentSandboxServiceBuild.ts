import * as ocp from "./openshift";

/**
 * The Agent Sandbox Service image's "Install Agent Sandbox Service" admin
 * action (Admin -> LLMs -> OpenShell -> "Agent Sandbox Service" card):
 * builds apps/agent-sandbox-service/Containerfile inside the OpenShift
 * cluster itself — the same OpenShift BuildConfig mechanism eeBuild.ts and
 * agentRuntimeBuild.ts use, just with a different Containerfile/context
 * and no AAP involvement at all (this service talks to OpenShift/the
 * OpenShell gateway directly, never through AAP).
 *
 * Unlike eeBuild.ts, there's no AAP-registration step — the built image's
 * reference feeds straight into deploy/openshift/agent-sandbox-service.yaml's
 * Deployment spec (see apps/web/src/server/agentSandbox.ts's
 * startAgentSandboxServiceInstall()/refreshAgentSandboxServiceInstall()
 * for that second, post-build phase).
 *
 * Same two-phase start/poll convention as every other build here:
 * startAgentSandboxServiceImageBuild() triggers the Build and returns
 * immediately; getAgentSandboxServiceImageBuildResult() polls it to
 * completion (returning undefined while still New/Pending/Running).
 */

/** Single shared BuildConfig/ImageStream name — there's only ever one
 * Agent Sandbox Service image, reused across every cluster this console
 * talks to (see apps/agent-sandbox-service/README.md). */
const AGENT_SANDBOX_SERVICE_BUILD_NAME = "agent-sandbox-service";
/** Empty string = repository root as the build context — required (like
 * agentRuntimeBuild.ts's AGENT_RUNTIME_CONTEXT_DIR, unlike the EE's own
 * subdirectory) because the Containerfile's COPY instructions
 * (package.json, apps/agent-sandbox-service, packages/) are all
 * repo-root-relative, needing the whole monorepo as build context to
 * resolve @agentstore/shared and friends. */
const AGENT_SANDBOX_SERVICE_CONTEXT_DIR = "";
const AGENT_SANDBOX_SERVICE_DOCKERFILE_PATH = "apps/agent-sandbox-service/Containerfile";
const BUILD_NAMESPACE = "agentstore";

export interface AgentSandboxServiceImageBuildInput {
  /** Any repo/branch containing apps/agent-sandbox-service/Containerfile
   * at that path — in practice the same one already configured for the
   * AAP Project (PlatformSettings.aapProjectGitUrl/aapProjectGitBranch),
   * reused purely because it's the one Git source AgentStore already has
   * on hand, not because AAP is otherwise involved. */
  gitUrl: string;
  gitBranch: string;
  gitSecretName?: string;
  /** Name of a Secret containing a GITHUB_TOKEN key with a `read:packages`
   * PAT — needed because @nvidia/openshell-sdk is published on GitHub
   * Packages, not npmjs.org. Omit to skip (build will fail if the .npmrc
   * references GITHUB_TOKEN and this isn't provided). */
  githubPackagesSecretName?: string;
}

/** Phase 1: finds-or-creates the ImageStream+BuildConfig and triggers a
 * new Build. Safe to call again later (e.g. after a failed build, or
 * after changing the Git URL/branch) — every OpenShift object here is
 * idempotent by name. */
export async function startAgentSandboxServiceImageBuild(
  input: AgentSandboxServiceImageBuildInput
): Promise<{ buildName: string }> {
  await ocp.findOrCreateEeImageStream(AGENT_SANDBOX_SERVICE_BUILD_NAME, BUILD_NAMESPACE);
  await ocp.findOrCreateEeBuildConfig({
    name: AGENT_SANDBOX_SERVICE_BUILD_NAME,
    imageStreamName: AGENT_SANDBOX_SERVICE_BUILD_NAME,
    gitUrl: input.gitUrl,
    gitBranch: input.gitBranch,
    contextDir: AGENT_SANDBOX_SERVICE_CONTEXT_DIR,
    dockerfilePath: AGENT_SANDBOX_SERVICE_DOCKERFILE_PATH,
    gitSecretName: input.gitSecretName,
    buildEnv: input.githubPackagesSecretName
      ? [
          {
            name: "GITHUB_TOKEN",
            valueFrom: {
              secretKeyRef: {
                name: input.githubPackagesSecretName,
                key: "GITHUB_TOKEN",
              },
            },
          },
        ]
      : undefined,
  }, BUILD_NAMESPACE);
  return ocp.startEeBuild(AGENT_SANDBOX_SERVICE_BUILD_NAME, BUILD_NAMESPACE);
}

/** Just the raw OpenShift Build phase, for the install button's progress
 * bar — see eeBuild.ts's getEeImageBuildPhase() for the same rationale. */
export async function getAgentSandboxServiceImageBuildPhase(buildName: string): Promise<string> {
  return (await ocp.getEeBuildStatus(buildName, BUILD_NAMESPACE)).phase;
}

export interface AgentSandboxServiceImageBuildResult {
  image: string;
}

/** Phase 2: polls the Build from phase 1; returns undefined while it's
 * still New/Pending/Running (the caller should try again shortly). Once
 * it's Complete, just reads back the built image's pullable reference —
 * no AAP registration step, same as agentRuntimeBuild.ts. */
export async function getAgentSandboxServiceImageBuildResult(
  buildName: string
): Promise<AgentSandboxServiceImageBuildResult | undefined> {
  const status = await ocp.getEeBuildStatus(buildName, BUILD_NAMESPACE);
  if (["New", "Pending", "Running"].includes(status.phase)) return undefined;
  if (status.phase !== "Complete") {
    throw new Error(
      `OpenShift build ${status.phase.toLowerCase()}${status.message ? ` — ${status.message}` : ""}. ` +
        `Check Build "${buildName}" logs in the OpenShift console and retry.`
    );
  }
  const image = await ocp.getEeImageReference(AGENT_SANDBOX_SERVICE_BUILD_NAME, "latest", BUILD_NAMESPACE);
  return { image };
}
