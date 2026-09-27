import { isAapConfigured, isOpenshiftConfigured } from "@agentstore/engine-ansible";
import { isOpenShellServiceConfigured } from "@agentstore/engine-openshell";
import type { EngineSettings } from "@agentstore/shared";
import { ensurePlatformEnv } from "./platform";

/**
 * Read-only "is this integration wired up" flags surfaced in Admin →
 * Platform → Execution. There's no more "force simulated" toggle or
 * per-listing engine adapter to pick — generic-chat listings either deploy
 * for real via AAP (see deployments.ts) or the button errors with why not,
 * and the same is true for openshell listings against the Agent Sandbox
 * Service (see openshellDeploy.ts).
 */
export function getEngineSettings(): EngineSettings {
  ensurePlatformEnv();
  return {
    openshellServiceConfigured: isOpenShellServiceConfigured(),
    aapConfigured: isAapConfigured(),
    openshiftConfigured: isOpenshiftConfigured(),
  };
}
