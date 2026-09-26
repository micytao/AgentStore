import type { PlatformSettings } from "@agentstore/shared";
import { getGatewayDeployStatus, isAapConfigured, launchGatewayDeploy } from "@agentstore/engine-ansible";
import { ensurePlatformEnv, getPlatformSettings, savePlatformSettings } from "./platform";

/**
 * The OpenShell gateway's "install once" admin action: launches
 * ansible/provision-openshell-gateway.yml via AAP and persists progress
 * onto `PlatformSettings.openshellGatewayDeployment` — platform-scoped
 * (one gateway per cluster/namespace), so it lives alongside the other
 * Platform tab settings instead of on a Listing, unlike deployments.ts's
 * per-listing generic-chat deploy flow it otherwise mirrors exactly.
 *
 * Deliberately does not touch the cluster-scoped Agent Sandbox
 * controller/CRDs prerequisite — see deploy/openshift/README.md.
 */

function now(): string {
  return new Date().toISOString();
}

const RELEASE_NAME = "openshell";

function persist(deployment: PlatformSettings["openshellGatewayDeployment"]): PlatformSettings {
  return savePlatformSettings({ openshellGatewayDeployment: deployment });
}

export async function startGatewayDeployment(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  if (!isAapConfigured()) {
    throw new Error("AAP is not configured — set the controller URL and token in Admin → Platform.");
  }
  const templateId = settings.openshellGatewayJobTemplateId;
  if (!templateId) {
    throw new Error(
      "No AAP job template set for the gateway install below — it must launch provision-openshell-gateway.yml."
    );
  }
  if (!settings.openshellGatewayChartRef.trim()) {
    throw new Error("Set a Helm chart reference for the OpenShell gateway first.");
  }
  const namespace = settings.openshellGatewayNamespace || "openshell";

  const { aapJobId, aapJobUrl } = await launchGatewayDeploy({
    jobTemplateId: templateId,
    releaseName: RELEASE_NAME,
    namespace,
    chartRef: settings.openshellGatewayChartRef,
    chartVersion: settings.openshellGatewayChartVersion,
    workloadKind: settings.openshellGatewayWorkloadKind,
  });

  return persist({
    status: "deploying",
    aapJobId,
    aapJobUrl,
    releaseName: RELEASE_NAME,
    namespace,
    chartRef: settings.openshellGatewayChartRef,
    chartVersion: settings.openshellGatewayChartVersion,
    workloadKind: settings.openshellGatewayWorkloadKind,
    updatedAt: now(),
  });
}

/**
 * Polls the in-flight gateway install (if any) and updates the persisted
 * OpenShellGatewayDeployment. A no-op when there's nothing in flight — safe
 * for the Admin UI to call on an interval, same pattern as
 * deployments.ts's refreshDeployment().
 */
export async function refreshGatewayDeployment(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  const deployment = settings.openshellGatewayDeployment;
  if (!deployment || deployment.status !== "deploying" || !deployment.aapJobId || !deployment.releaseName || !deployment.namespace) {
    return settings;
  }

  const result = await getGatewayDeployStatus(deployment.aapJobId, deployment.releaseName, deployment.namespace);
  return persist({
    ...deployment,
    status: result.status,
    gatewayUrl: result.gatewayUrl ?? deployment.gatewayUrl,
    error: result.error,
    updatedAt: now(),
  });
}
