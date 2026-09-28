import * as aap from "./aap";

/**
 * The "Create job templates" admin action (Admin -> Platform -> AAP Job
 * Templates): creates the AAP objects the two existing "deploy via AAP"
 * flows already know how to *launch* by id —
 * genericAgentDeploy.ts's launchGenericAgentDeploy() (autonomous,
 * provision-generic-agent.yml) and gatewayDeploy.ts's
 * launchGatewayDeploy() (collaborative, provision-openshell-gateway.yml)
 * — instead of requiring the admin to click around the AAP web UI once
 * to hand-create them, as ansible/README.md otherwise documents.
 *
 * Split into two phases, mirroring the polled start/refresh convention
 * genericAgentDeploy.ts and gatewayDeploy.ts already use: a Project's
 * initial SCM sync is the only step here that can take longer than a
 * single request should block for, so startJobTemplateBootstrap() kicks
 * it off and returns immediately, and finishJobTemplateBootstrap() polls
 * it to completion (returning undefined while still syncing) before
 * creating the Inventory/Credential/Job Templates, which are all fast
 * synchronous AAP API calls.
 */

export interface JobTemplateBootstrapInput {
  organizationName: string;
  projectName: string;
  gitUrl: string;
  gitBranch: string;
  scmCredentialId?: number;
  executionEnvironmentId: number;
  /** Reuses the OpenShift URL/token AgentStore already has configured —
   * see apps/web's aapBootstrap.ts, which reads these from
   * PlatformSettings/the vault rather than asking the admin again. */
  kubernetesCredential: {
    apiUrl: string;
    token: string;
    verifySsl: boolean;
  };
}

export interface JobTemplateBootstrapHandle {
  projectId: number;
  projectUpdateId: number;
}

export interface JobTemplateBootstrapResult {
  autonomousJobTemplateId: number;
  collaborativeJobTemplateId: number;
}

const AUTONOMOUS_TEMPLATE_NAME = "AgentStore - provision generic agent";
const COLLABORATIVE_TEMPLATE_NAME = "AgentStore - provision openshell gateway";
const INVENTORY_NAME = "AgentStore - localhost";
const KUBERNETES_CREDENTIAL_NAME = "AgentStore - OpenShift API";
/** AAP's Job Template `playbook` field is a path relative to the
 * Project's repo root, not relative to some fixed "playbooks dir" — and
 * the admin is expected to point the Project's Git URL at the whole
 * AgentStore repo (so AAP can see this same ansible/README.md alongside
 * everything else), not just this `ansible/` subdirectory. Both actual
 * playbook files live under `ansible/`, so that prefix has to be part of
 * the path AAP looks up. */
const PLAYBOOK_PATH_PREFIX = "ansible/";

/** Phase 1: resolves the Organization, finds-or-creates the Project, and
 * triggers its SCM sync. Safe to call again later (e.g. after the admin
 * changes the Git URL/branch) — findOrCreateProject() is idempotent by
 * name. */
export async function startJobTemplateBootstrap(
  input: JobTemplateBootstrapInput
): Promise<JobTemplateBootstrapHandle> {
  const org = await aap.findOrganizationByName(input.organizationName);
  const project = await aap.findOrCreateProject({
    name: input.projectName,
    organizationId: org.id,
    scmUrl: input.gitUrl,
    scmBranch: input.gitBranch,
    scmCredentialId: input.scmCredentialId,
  });
  const { projectUpdateId } = await aap.syncProject(project.id);
  return { projectId: project.id, projectUpdateId };
}

/** Phase 2: polls the Project sync from phase 1; returns undefined while
 * it's still running (the caller should try again shortly). Once the
 * sync succeeds, creates the Inventory+localhost Host, the Kubernetes
 * Bearer Token credential, and both Job Templates — every step here is
 * itself idempotent, so re-polling after a partial failure (e.g. the
 * server restarted) just re-verifies/re-creates whatever's missing
 * rather than duplicating objects. */
export async function finishJobTemplateBootstrap(
  input: JobTemplateBootstrapInput,
  handle: JobTemplateBootstrapHandle
): Promise<JobTemplateBootstrapResult | undefined> {
  const sync = await aap.getProjectUpdateStatus(handle.projectUpdateId);
  if (["pending", "waiting", "running"].includes(sync.status)) return undefined;
  if (sync.status !== "successful") {
    throw new Error(
      `AAP project sync ${sync.status} — open the Project in AAP for the sync log, fix the Git URL/branch/credential, and retry.`
    );
  }

  const org = await aap.findOrganizationByName(input.organizationName);

  const inventory = await aap.findOrCreateInventory({ name: INVENTORY_NAME, organizationId: org.id });
  await aap.findOrCreateLocalhostHost(inventory.id);

  const credential = await aap.findOrCreateKubernetesCredential({
    name: KUBERNETES_CREDENTIAL_NAME,
    organizationId: org.id,
    apiUrl: input.kubernetesCredential.apiUrl,
    bearerToken: input.kubernetesCredential.token,
    verifySsl: input.kubernetesCredential.verifySsl,
  });

  const autonomous = await aap.findOrCreateJobTemplate({
    name: AUTONOMOUS_TEMPLATE_NAME,
    projectId: handle.projectId,
    playbook: PLAYBOOK_PATH_PREFIX + "provision-generic-agent.yml",
    inventoryId: inventory.id,
    executionEnvironmentId: input.executionEnvironmentId,
  });
  await aap.attachCredentialToJobTemplate(autonomous.id, credential.id);

  const collaborative = await aap.findOrCreateJobTemplate({
    name: COLLABORATIVE_TEMPLATE_NAME,
    projectId: handle.projectId,
    playbook: PLAYBOOK_PATH_PREFIX + "provision-openshell-gateway.yml",
    inventoryId: inventory.id,
    executionEnvironmentId: input.executionEnvironmentId,
  });
  await aap.attachCredentialToJobTemplate(collaborative.id, credential.id);

  return {
    autonomousJobTemplateId: autonomous.id,
    collaborativeJobTemplateId: collaborative.id,
  };
}
