import fs from "node:fs";
import path from "node:path";
import { createAnsibleEngine, isAapConfigured, isOpenshiftConfigured } from "@agentstore/engine-ansible";
import { fakeEngine } from "@agentstore/engine-fake";
import { isOpenShellServiceConfigured, openShellEngine } from "@agentstore/engine-openshell";
import type { EngineAdapter, EngineSettings, Listing } from "@agentstore/shared";
import { ensurePlatformEnv } from "./platform";

type PersistedEngineSettings = { forceSimulated: boolean };

const DEFAULT_ENGINE_SETTINGS: PersistedEngineSettings = { forceSimulated: false };

// File-backed so an admin's "force simulated" safety toggle survives a
// process restart instead of silently reverting to "try live" (same
// dataDir()/loadFromDisk() pattern as platform.ts).
function dataDir(): string {
  if (process.env.SECRETS_DATA_DIR) return process.env.SECRETS_DATA_DIR;
  const candidates = [
    path.resolve(process.cwd(), ".data"),
    path.resolve(process.cwd(), "../../.data"),
    path.resolve(__dirname, "../../../../.data"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

function settingsPath(): string {
  return path.join(dataDir(), "engine-settings.json");
}

function loadFromDisk(): PersistedEngineSettings {
  const file = settingsPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_ENGINE_SETTINGS };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PersistedEngineSettings>;
    return { ...DEFAULT_ENGINE_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_ENGINE_SETTINGS };
  }
}

let cached: PersistedEngineSettings | null = null;

function settingsStore(): PersistedEngineSettings {
  if (!cached) cached = loadFromDisk();
  return cached;
}

export function getEngineSettings(): EngineSettings {
  ensurePlatformEnv();
  return {
    forceSimulated: settingsStore().forceSimulated,
    openshellServiceConfigured: isOpenShellServiceConfigured(),
    aapConfigured: isAapConfigured(),
    openshiftConfigured: isOpenshiftConfigured(),
  };
}

export function setEngineSettings(patch: Partial<EngineSettings>): EngineSettings {
  if (typeof patch.forceSimulated === "boolean") {
    const next: PersistedEngineSettings = { ...settingsStore(), forceSimulated: patch.forceSimulated };
    const dir = dataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
    cached = next;
  }
  return getEngineSettings();
}

function isOpenShellLive(listing: Listing): boolean {
  const override = listing.agentConfig?.engineOverride;
  if (override === "simulated") return false;
  if (override === "live") {
    return Boolean(listing.openshellAgent && isOpenShellServiceConfigured());
  }
  if (settingsStore().forceSimulated) return false;
  return Boolean(listing.openshellAgent && isOpenShellServiceConfigured());
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