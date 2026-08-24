import { createAnsibleEngine, isAapConfigured, isOpenshiftConfigured } from "@agentstore/engine-ansible";
import { fakeEngine } from "@agentstore/engine-fake";
import { openShellEngine } from "@agentstore/engine-openshell";
import type { EngineAdapter, EngineSettings, Listing } from "@agentstore/shared";
import { ensurePlatformEnv } from "./platform";

type SettingsStore = { forceSimulated: boolean };

function settingsStore(): SettingsStore {
  const g = globalThis as typeof globalThis & { __agentStoreEngineSettings?: SettingsStore };
  if (!g.__agentStoreEngineSettings) {
    g.__agentStoreEngineSettings = { forceSimulated: false };
  }
  return g.__agentStoreEngineSettings;
}

export function getEngineSettings(): EngineSettings {
  ensurePlatformEnv();
  return {
    forceSimulated: settingsStore().forceSimulated,
    gatewayConfigured: Boolean(process.env.OPENSHELL_GATEWAY_URL),
    aapConfigured: isAapConfigured(),
    openshiftConfigured: isOpenshiftConfigured(),
  };
}

export function setEngineSettings(patch: Partial<EngineSettings>): EngineSettings {
  if (typeof patch.forceSimulated === "boolean") {
    settingsStore().forceSimulated = patch.forceSimulated;
  }
  return getEngineSettings();
}

function isOpenShellLive(listing: Listing): boolean {
  const override = listing.agentConfig?.engineOverride;
  if (override === "simulated") return false;
  if (override === "live") {
    return Boolean(listing.openshellAgent && process.env.OPENSHELL_GATEWAY_URL);
  }
  if (settingsStore().forceSimulated) return false;
  return Boolean(listing.openshellAgent && process.env.OPENSHELL_GATEWAY_URL);
}

function isAapLive(listing: Listing): boolean {
  const override = listing.agentConfig?.engineOverride;
  if (override === "simulated") return false;
  if (override === "live") return isAapConfigured();
  if (settingsStore().forceSimulated) return false;
  return isAapConfigured();
}

export function adapterFor(listing: Listing): EngineAdapter {
  ensurePlatformEnv();
  if (isOpenShellLive(listing)) {
    return openShellEngine;
  }
  if (listing.openshellAgent) {
    return fakeEngine;
  }
  return createAnsibleEngine({
    forceSimulated: () => !isAapLive(listing),
  });
}

/** True when this listing will hit a real AAP job or a real OpenShell sandbox. */
export function isLiveEngine(listing: Listing): boolean {
  ensurePlatformEnv();
  if (listing.openshellAgent) return isOpenShellLive(listing);
  return isAapLive(listing);
}