import type { AgentDeploymentStatus, OpenShellMcpServerConfig, ProviderKind, Skill } from "@agentstore/shared";
import * as aap from "./aap";
import { aapJobUrl, agentRuntimeImage, isOpenshiftConfigured, openshiftNamespace } from "./config";
import * as ocp from "./openshift";

/**
 * The generic-chat runtime's "deploy once" flow: launches
 * ansible/provision-generic-agent.yml via AAP (a Deployment+Service+Route,
 * not a batch Job) and polls it to completion, reading the Route host back
 * from the `<deployment_name>-deploy-result` ConfigMap the playbook
 * writes. Deliberately separate from EngineAdapter — that interface is
 * built around per-Task provision/getStatus/terminate with a TaskSpec,
 * and this is a per-listing, one-time admin action with a different shape
 * of inputs (provider, skills, MCP servers) — apps/web/src/server/
 * deployments.ts calls straight into this instead of going through
 * adapterFor().
 */

export interface GenericAgentDeployInput {
  listingId: string;
  listingName: string;
  /** Stable per-listing resource name for the Deployment/Service/Route/
   * Secret (e.g. `agent-<shortid>`) — same shortening convention
   * index.ts's jobNameFor() uses for Task-scoped Jobs. */
  deploymentName: string;
  /** AAP Job Template pointing at provision-generic-agent.yml — reuses the
   * listing's `agentConfig.aapJobTemplateId` (or the Platform default);
   * for a generic-chat listing that field must point at a template
   * running provision-generic-agent.yml, not provision-agent.yml. */
  jobTemplateId: number;
  provider: {
    kind: ProviderKind;
    baseUrl?: string;
    defaultModel?: string;
    apiKey?: string;
  };
  introLines: string[];
  skills: Skill[];
  mcpServers: OpenShellMcpServerConfig[];
}

export async function launchGenericAgentDeploy(
  input: GenericAgentDeployInput
): Promise<{ aapJobId: string; aapJobUrl?: string }> {
  const launched = await aap.launchJobTemplate(input.jobTemplateId, {
    deployment_name: input.deploymentName,
    namespace: openshiftNamespace(),
    listing_id: input.listingId,
    listing_name: input.listingName,
    agent_runtime_image: agentRuntimeImage(),
    provider_kind: input.provider.kind,
    provider_base_url: input.provider.baseUrl ?? "",
    provider_default_model: input.provider.defaultModel ?? "",
    provider_api_key: input.provider.apiKey ?? "",
    intro_lines: input.introLines,
    skills: input.skills,
    mcp_servers: input.mcpServers,
  });
  return { aapJobId: String(launched.id), aapJobUrl: aapJobUrl(launched.id) };
}

export interface GenericAgentDeployStatus {
  status: AgentDeploymentStatus;
  routeUrl?: string;
  error?: string;
}

export async function getGenericAgentDeployStatus(
  aapJobId: string,
  deploymentName: string
): Promise<GenericAgentDeployStatus> {
  let aapStatus = "unknown";
  try {
    const job = await aap.getJob(aapJobId);
    aapStatus = job.status;
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }

  if (["new", "pending", "waiting", "running"].includes(aapStatus)) {
    return { status: "deploying" };
  }
  if (["failed", "error", "canceled"].includes(aapStatus)) {
    return { status: "failed", error: `AAP job ${aapStatus}` };
  }

  if (!isOpenshiftConfigured()) {
    return {
      status: "failed",
      error: "AAP job succeeded but OpenShift API is not configured — cannot read back the Route host.",
    };
  }
  try {
    const result = await ocp.readDeploymentResult(deploymentName);
    if (result?.routeHost) {
      return { status: "running", routeUrl: `https://${result.routeHost}` };
    }
    if (result?.status === "failed") {
      return { status: "failed", error: "Deployment did not become available in time." };
    }
    return { status: "deploying" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteGenericAgentDeployment(deploymentName: string): Promise<void> {
  if (!isOpenshiftConfigured()) return;
  await ocp.deleteGenericAgentDeployment(deploymentName);
}
