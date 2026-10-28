import { isOpenshiftConfigured } from "@agentstore/engine-openshift";
import { isOpenShellServiceConfigured } from "@agentstore/engine-openshell";
import type { EngineSettings } from "@agentstore/shared";
import { ensurePlatformEnv } from "./platform";

/**
 * Read-only "is this integration wired up" flags surfaced in Admin →
 * Platform → Execution. Generic-chat listings either deploy for real via
 * direct OpenShift deployment (see deployments.ts) or the button errors
 * with why not, and the same is true for openshell listings against the
 * Agent Sandbox Service (see openshellDeploy.ts).
 */
export function getEngineSettings(): EngineSettings {
  ensurePlatformEnv();
  return {
    openshellServiceConfigured: isOpenShellServiceConfigured(),
    openshiftConfigured: isOpenshiftConfigured(),
  };
}
