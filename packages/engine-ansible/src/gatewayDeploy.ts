import type { AgentDeploymentStatus, GatewayWorkloadKind } from "@agentstore/shared";
import * as aap from "./aap";
import { aapJobUrl, isOpenshiftConfigured } from "./config";
import * as ocp from "./openshift";

/**
 * The OpenShell gateway's "install once" flow: launches
 * ansible/provision-openshell-gateway.yml via AAP (a live `helm upgrade
 * --install` against the admin-supplied chart ref, defaulting to NVIDIA's
 * real published chart at `oci://ghcr.io/nvidia/openshell/helm-chart` —
 * see docs.nvidia.com/openshell/kubernetes/openshift) and polls it to
 * completion, reading readiness back from the `<release_name>
 * -gateway-result` ConfigMap the playbook writes.
 *
 * Platform-scoped (one gateway per cluster/namespace), not per-listing —
 * apps/web/src/server/gateway.ts calls straight into this, the same way
 * deployments.ts calls genericAgentDeploy.ts, but persists the result onto
 * PlatformSettings instead of a Listing.
 *
 * Deliberately does NOT install the cluster-scoped Agent Sandbox
 * controller/CRDs — that's a one-time, elevated-privilege, per-cluster
 * bootstrap step documented in deploy/openshift/README.md as a
 * platform-admin action outside this self-service flow (like installing
 * OpenShift itself), so this AAP job's Kubernetes credential can stay
 * scoped to just the gateway's own namespace.
 */

export interface GatewayDeployInput {
  /** AAP Job Template pointing at provision-openshell-gateway.yml. */
  jobTemplateId: number;
  /** Helm release name — also the base name for the ConfigMap/Service the
   * playbook reads back from. */
  releaseName: string;
  namespace: string;
  chartRef: string;
  chartVersion?: string;
  workloadKind: GatewayWorkloadKind;
}

export async function launchGatewayDeploy(
  input: GatewayDeployInput
): Promise<{ aapJobId: string; aapJobUrl?: string }> {
  const launched = await aap.launchJobTemplate(input.jobTemplateId, {
    release_name: input.releaseName,
    namespace: input.namespace,
    chart_ref: input.chartRef,
    chart_version: input.chartVersion ?? "",
    workload_kind: input.workloadKind,
  });
  return { aapJobId: String(launched.id), aapJobUrl: aapJobUrl(launched.id) };
}

export interface GatewayDeployStatus {
  status: AgentDeploymentStatus;
  gatewayUrl?: string;
  error?: string;
}

export async function getGatewayDeployStatus(
  aapJobId: string,
  releaseName: string,
  namespace: string
): Promise<GatewayDeployStatus> {
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
      error: "AAP job succeeded but OpenShift API is not configured — cannot read back gateway readiness.",
    };
  }
  try {
    const result = await ocp.readGatewayDeployResult(releaseName, namespace);
    if (result?.status === "running") {
      return { status: "running", gatewayUrl: result.gatewayUrl };
    }
    if (result?.status === "failed") {
      return { status: "failed", error: result.error || "Gateway workload did not become ready in time." };
    }
    return { status: "deploying" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
