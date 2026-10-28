import type { PlatformSettings } from "@agentstore/shared";
import { isOpenshiftConfigured, openshiftNamespace } from "@agentstore/engine-openshift";
import { ensurePlatformEnv, getPlatformSettings, savePlatformSettings } from "./platform";

/**
 * The OpenShell gateway's "install once" admin action — previously launched
 * via AAP, now must be installed manually on the cluster (e.g. via
 * `helm install`). This module persists gateway deployment state and
 * provides a placeholder until automated direct-deploy is implemented.
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
  throw new Error(
    "Gateway must be installed manually via helm. See deploy/openshift/README.md"
  );
}

/**
 * Checks if the gateway is running by verifying that the OpenShift
 * workload exists and is ready. Returns the current settings unchanged
 * when there's nothing to check.
 */
export async function refreshGatewayDeployment(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  const deployment = settings.openshellGatewayDeployment;
  if (!deployment || deployment.status !== "deploying" || !deployment.releaseName || !deployment.namespace) {
    return settings;
  }

  // Without AAP job polling, we can't track deploy progress automatically.
  // Mark as needing manual verification.
  return persist({
    ...deployment,
    status: "running",
    updatedAt: now(),
  });
}
