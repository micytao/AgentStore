/**
 * This package's public surface is now just: a generic AAP REST client
 * (aap.ts), a generic OpenShift API client (openshift.ts), platform
 * connection settings (config.ts), and the two "deploy once via AAP" flows
 * that actually still exist — generic-chat agents (genericAgentDeploy.ts)
 * and the OpenShell gateway itself (gatewayDeploy.ts). The old per-Task
 * "provision an OpenShift Job, poll it, read a result ConfigMap" engine
 * adapter (createAnsibleEngine/ansibleEngine) was retired along with the
 * one-shot Skills Agent draft/approve flow — see ansible/provision-agent.yml
 * (deleted) and apps/agent-runtime/src/runOnce.ts (deleted).
 */
export {
  pingAap,
  listJobTemplates,
  listRecentJobs,
  listExecutionEnvironments,
  listCredentialsByKind,
  listOrganizations,
  listProjects,
  findOrCreateExecutionEnvironment,
  type FindOrCreateExecutionEnvironmentInput,
} from "./aap";
export {
  pingOpenshift,
  listAgentDeployments,
  checkAgentSandboxController,
  applyAgentSandboxManifests,
  findOrCreateAgentSandboxServiceTokenSecret,
  ensureSecretValue,
  getAgentSandboxServiceReadiness,
  getAgentSandboxServiceRouteHost,
  restartAgentSandboxServiceDeployment,
  checkRhdhOperator,
  applyBackstageCR,
  checkNamespaceDeploymentReadiness,
  restartNamespaceDeployments,
  getNamespaceRouteHost,
} from "./openshift";
export {
  startAgentSandboxServiceImageBuild,
  getAgentSandboxServiceImageBuildPhase,
  getAgentSandboxServiceImageBuildResult,
  type AgentSandboxServiceImageBuildInput,
  type AgentSandboxServiceImageBuildResult,
} from "./agentSandboxServiceBuild";
export {
  startEeImageBuild,
  getEeImageBuildResult,
  getEeImageBuildPhase,
  getEeImageBuildLog,
  type EeImageBuildInput,
  type EeImageBuildResult,
} from "./eeBuild";
export {
  startAgentRuntimeImageBuild,
  getAgentRuntimeImageBuildResult,
  getAgentRuntimeImageBuildPhase,
  getAgentRuntimeImageBuildLog,
  type AgentRuntimeImageBuildInput,
  type AgentRuntimeImageBuildResult,
} from "./agentRuntimeBuild";
export {
  applyPlatformEnv,
  isAapConfigured,
  isOpenshiftConfigured,
  aapControllerUrl,
  aapConsoleUrl,
  aapDefaultJobTemplateId,
  openshiftApiUrl,
  openshiftNamespace,
  openshiftConsoleUrl,
  openshiftInsecureTls,
  agentRuntimeImage,
} from "./config";
export {
  deleteGenericAgentDeployment,
  getGenericAgentDeployStatus,
  launchGenericAgentDeploy,
  type GenericAgentDeployInput,
  type GenericAgentDeployStatus,
} from "./genericAgentDeploy";
export {
  getGatewayDeployStatus,
  launchGatewayDeploy,
  type GatewayDeployInput,
  type GatewayDeployStatus,
} from "./gatewayDeploy";
export {
  startJobTemplateBootstrap,
  finishJobTemplateBootstrap,
  type JobTemplateBootstrapInput,
  type JobTemplateBootstrapHandle,
  type JobTemplateBootstrapResult,
} from "./jobTemplateBootstrap";
export {
  startAgentStoreImageBuild,
  getAgentStoreImageBuildPhase,
  getAgentStoreImageBuildResult,
  getAgentStoreImageBuildLog,
  type AgentStoreImageBuildInput,
  type AgentStoreImageBuildResult,
} from "./agentstoreImageBuild";
/** Exported so deployments.ts can derive a stable per-listing resource
 * name — DNS-1123-safe (lowercase alphanumeric + "-", no leading/trailing
 * "-"), since it becomes a Deployment/Service/Route/Secret name. */
export function genericAgentDeploymentName(listingId: string): string {
  const slug = listingId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `agent-${slug || "listing"}`;
}
