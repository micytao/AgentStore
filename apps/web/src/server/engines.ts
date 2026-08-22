import { fakeEngine } from "@agentstore/engine-fake";
import { openShellEngine } from "@agentstore/engine-openshell";
import type { EngineAdapter, EngineSettings, Listing } from "@agentstore/shared";

type SettingsStore = { forceSimulated: boolean };

function settingsStore(): SettingsStore {
  const g = globalThis as typeof globalThis & { __agentStoreEngineSettings?: SettingsStore };
  if (!g.__agentStoreEngineSettings) {
    g.__agentStoreEngineSettings = { forceSimulated: false };
  }
  return g.__agentStoreEngineSettings;
}

export function getEngineSettings(): EngineSettings {
  return {
    forceSimulated: settingsStore().forceSimulated,
    gatewayConfigured: Boolean(process.env.OPENSHELL_GATEWAY_URL),
  };
}

export function setEngineSettings(patch: Partial<EngineSettings>): EngineSettings {
  if (typeof patch.forceSimulated === "boolean") {
    settingsStore().forceSimulated = patch.forceSimulated;
  }
  return getEngineSettings();
}

export function adapterFor(listing: Listing): EngineAdapter {
  if (isLiveEngine(listing)) {
    return openShellEngine;
  }
  return fakeEngine;
}

export function isLiveEngine(listing: Listing): boolean {
  const override = listing.agentConfig?.engineOverride;
  if (override === "simulated") return false;
  if (override === "live") {
    return Boolean(listing.openshellAgent && process.env.OPENSHELL_GATEWAY_URL);
  }
  // "auto" (or unset): fall back to the global setting, as before.
  if (settingsStore().forceSimulated) return false;
  return Boolean(listing.openshellAgent && process.env.OPENSHELL_GATEWAY_URL);
}
