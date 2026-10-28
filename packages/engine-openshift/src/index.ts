/**
 * OpenShift engine package — provides direct OpenShift API integration
 * for deploying agents, building images, and managing platform resources.
 * Replaces the previous AAP-based provisioning with native K8s API calls.
 */
export {
  pingOpenshift,
  ensureNamespace,
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
  deleteGenericAgentDeployment,
  applyResource,
  getDeploymentReadiness,
  getRouteHost,
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
  isOpenshiftConfigured,
  openshiftApiUrl,
  openshiftNamespace,
  openshiftConsoleUrl,
  openshiftInsecureTls,
  agentRuntimeImage,
  openshiftDeploymentConsoleUrl,
} from "./config";
export {
  launchDirectDeploy,
  getDirectDeployStatus,
  type DirectDeployInput,
  type DirectDeployStatus,
} from "./directDeploy";
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
