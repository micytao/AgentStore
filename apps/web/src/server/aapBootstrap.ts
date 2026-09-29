import type { AapBootstrapStatus, PlatformSettings } from "@agentstore/shared";
import {
  finishJobTemplateBootstrap,
  findOrCreateExecutionEnvironment,
  isAapConfigured,
  isOpenshiftConfigured,
  openshiftInsecureTls,
  startJobTemplateBootstrap,
  type JobTemplateBootstrapInput,
} from "@agentstore/engine-ansible";
import { ensurePlatformEnv, getPlatformSettings, savePlatformSettings } from "./platform";
import { getSecret } from "./secrets";

/**
 * The "Create job templates" admin action (Admin -> Platform -> AAP Job
 * Templates): the AgentStore-side wiring around
 * packages/engine-ansible's jobTemplateBootstrap.ts, following the exact
 * same two-phase start/refresh convention as deployments.ts and
 * gateway.ts — startBootstrap() kicks off the Project's SCM sync and
 * returns immediately; refreshBootstrap() polls it and, once synced,
 * finishes creating the Inventory/Credential/Job Templates. Both persist
 * progress onto PlatformSettings.aapBootstrap so the Admin UI can poll
 * this the same way it already polls openshellGatewayDeployment.
 */

function now(): string {
  return new Date().toISOString();
}

function persist(bootstrap: AapBootstrapStatus, extra?: Partial<PlatformSettings>): PlatformSettings {
  return savePlatformSettings({ ...extra, aapBootstrap: bootstrap });
}

/** Validates the admin's bootstrap inputs and builds the payload
 * jobTemplateBootstrap.ts needs — including the Kubernetes credential,
 * which reuses the OpenShift API URL/token AgentStore already has
 * configured (Admin -> Platform -> OpenShift) rather than asking for a
 * separate one. */
function bootstrapInputFrom(settings: PlatformSettings): JobTemplateBootstrapInput {
  if (!settings.aapProjectGitUrl.trim()) {
    throw new Error("Set a Project Git URL for the AAP job template bootstrap first.");
  }
  if (!settings.aapExecutionEnvironmentId) {
    throw new Error("Pick an Execution Environment for the AAP job template bootstrap first.");
  }
  const apiUrl = settings.openshiftApiUrl;
  const token = getSecret("OPENSHIFT_TOKEN");
  if (!apiUrl || !token) {
    throw new Error(
      "OpenShift API URL/token must be configured (Admin → Platform → OpenShift) before creating job templates — the bootstrap reuses them for the Kubernetes credential it creates in AAP."
    );
  }
  return {
    organizationName: settings.aapOrganizationName || "Default",
    projectName: settings.aapProjectName || "AgentStore",
    gitUrl: settings.aapProjectGitUrl,
    gitBranch: settings.aapProjectGitBranch || "main",
    scmCredentialId: settings.aapProjectScmCredentialId ? Number(settings.aapProjectScmCredentialId) : undefined,
    executionEnvironmentId: Number(settings.aapExecutionEnvironmentId),
    kubernetesCredential: {
      apiUrl,
      token,
      verifySsl: !settings.openshiftInsecureTls,
    },
  };
}

/**
 * Starts (or re-starts, e.g. after a failure or a changed Git URL) the
 * job template bootstrap. Persists an initial "deploying" (= in
 * progress) AapBootstrapStatus immediately and returns; the Admin UI
 * polls refreshBootstrap() for progress.
 */
export async function startBootstrap(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  if (!isAapConfigured()) {
    throw new Error("AAP is not configured — set the controller URL and token in Admin → Platform.");
  }
  if (!isOpenshiftConfigured()) {
    throw new Error("OpenShift is not configured — set the API URL and token in Admin → Platform.");
  }

  try {
    const input = bootstrapInputFrom(settings);
    const handle = await startJobTemplateBootstrap(input);
    return persist({
      status: "deploying",
      phase: "syncing-project",
      projectId: handle.projectId,
      projectUpdateId: handle.projectUpdateId,
      updatedAt: now(),
    });
  } catch (err) {
    return persist({ status: "failed", error: err instanceof Error ? err.message : String(err), updatedAt: now() });
  }
}

/**
 * Polls the in-flight bootstrap (if any) and updates the persisted
 * AapBootstrapStatus. A no-op that just returns the settings unchanged
 * when there's nothing in flight — safe for the Admin UI to call on an
 * interval, same pattern as deployments.ts's refreshDeployment().
 */
export async function refreshBootstrap(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  const bootstrap = settings.aapBootstrap;
  if (!bootstrap || bootstrap.status !== "deploying" || !bootstrap.projectId || !bootstrap.projectUpdateId) {
    return settings;
  }

  try {
    const input = bootstrapInputFrom(settings);
    const result = await finishJobTemplateBootstrap(input, {
      projectId: bootstrap.projectId,
      projectUpdateId: bootstrap.projectUpdateId,
    });
    if (!result) {
      // Project sync is still running — nothing more to do this poll.
      return persist({ ...bootstrap, phase: "syncing-project", updatedAt: now() });
    }
    // "running" here means "job templates created and ready to launch",
    // the same AgentDeploymentStatus vocabulary AgentDeployment/
    // OpenShellGatewayDeployment already use for "done".
    return persist(
      {
        ...bootstrap,
        status: "running",
        phase: "done",
        autonomousJobTemplateId: result.autonomousJobTemplateId,
        collaborativeJobTemplateId: result.collaborativeJobTemplateId,
        autonomousCreated: result.autonomousCreated,
        collaborativeCreated: result.collaborativeCreated,
        updatedAt: now(),
      },
      {
        aapJobTemplateId: result.autonomousJobTemplateId,
        openshellGatewayJobTemplateId: result.collaborativeJobTemplateId,
      }
    );
  } catch (err) {
    return persist({
      ...bootstrap,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      updatedAt: now(),
    });
  }
}

/**
 * "Register a new image" — the one piece of the Execution Environment
 * story the AAP API *can* do (building/pushing the image itself has to
 * happen locally/in CI first, see
 * ansible/execution-environment/README.md). Registers the given image as
 * an AAP Execution Environment object and immediately auto-selects it as
 * `aapExecutionEnvironmentId`, so the admin doesn't have to separately
 * find it in the dropdown afterward.
 */
export async function registerExecutionEnvironment(input: {
  name: string;
  image: string;
  credentialId?: number;
}): Promise<PlatformSettings> {
  ensurePlatformEnv();
  if (!isAapConfigured()) {
    throw new Error("AAP is not configured — set the controller URL and token in Admin → Platform.");
  }
  if (!input.name.trim() || !input.image.trim()) {
    throw new Error("Both a name and an image reference are required to register an execution environment.");
  }
  const ee = await findOrCreateExecutionEnvironment({
    name: input.name.trim(),
    image: input.image.trim(),
    credentialId: input.credentialId,
  });
  return savePlatformSettings({ aapExecutionEnvironmentId: ee.id });
}
