import fs from "node:fs";
import path from "node:path";
import type { PlatformSettings } from "@agentstore/shared";
import { getDataDir, importSecrets } from "./secrets";
import {
  writeCatalogOverrides,
  writeCustomListings,
  writeDeletedListings,
  writeProviders,
} from "./dataDirFiles";

/**
 * Seed merge: on startup, check for seed files mounted at /app/.seed/
 * by the deploy ConfigMap/Secret.  If present and newer than the last
 * applied seed, merge them into the local .data/ directory.
 *
 * This runs BEFORE the vault hydration loop in secrets.ts so that
 * imported secrets are available in process.env when the app starts
 * serving requests.
 */

const SEED_CONFIG_DIR = "/app/.seed/config";
const SEED_SECRETS_DIR = "/app/.seed/secrets";
const SEED_APPLIED_MARKER = ".seed-applied";

export function mergeSeedState(): void {
  if (!fs.existsSync(SEED_CONFIG_DIR)) return;

  const dataDir = getDataDir();
  const markerPath = path.join(dataDir, SEED_APPLIED_MARKER);

  // Check if we need to re-merge: compare the seed timestamp annotation
  // (stored as a file in the ConfigMap mount) with the marker.
  const seedTimestamp = readSeedFile("platform.json")
    ? fs.statSync(path.join(SEED_CONFIG_DIR, "platform.json")).mtimeMs
    : 0;

  if (fs.existsSync(markerPath)) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as { appliedAt: number };
      if (marker.appliedAt >= seedTimestamp) return;
    } catch {
      // Corrupted marker — re-merge
    }
  }

  console.log("[seed-merge] Merging seed state into .data/");

  // Ensure .data/ exists
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // --- Platform settings: merge config fields, preserve deploy status ---
  mergePlatformSettings(dataDir);

  // --- Secrets: import into vault (re-encrypted with this pod's key) ----
  mergeSecrets();

  // --- Catalog overrides: replace ----------------------------------------
  const catalogOverrides = readSeedJson<Record<string, unknown>>("catalog-overrides.json");
  if (catalogOverrides) writeCatalogOverrides(catalogOverrides);

  // --- Deleted listings: replace -----------------------------------------
  const deletedListings = readSeedJson<string[]>("deleted-listings.json");
  if (deletedListings) writeDeletedListings(deletedListings);

  // --- Providers: replace ------------------------------------------------
  const providers = readSeedJson<unknown[]>("providers.json");
  if (providers) writeProviders(providers);

  // --- Custom listings: copy YAML files ----------------------------------
  mergeCustomListings();

  // Write marker
  fs.writeFileSync(markerPath, JSON.stringify({ appliedAt: Date.now() }));
  console.log("[seed-merge] Seed merge complete.");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSeedFile(filename: string): string | null {
  const file = path.join(SEED_CONFIG_DIR, filename);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

function readSeedJson<T>(filename: string): T | null {
  const raw = readSeedFile(filename);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function mergePlatformSettings(dataDir: string): void {
  const seedSettings = readSeedJson<Partial<PlatformSettings>>("platform.json");
  if (!seedSettings) return;

  const existingPath = path.join(dataDir, "platform.json");
  let existing: Partial<PlatformSettings> = {};
  if (fs.existsSync(existingPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(existingPath, "utf8")) as Partial<PlatformSettings>;
    } catch {
      existing = {};
    }
  }

  // Seed provides connection/config fields.  Preserve the cluster's own
  // deploy-status fields if they already exist on disk.
  const merged: Partial<PlatformSettings> = {
    ...existing,
    ...seedSettings,
    // Keep cluster-owned status blobs
    agentstoreDeploy: existing.agentstoreDeploy,
    rhdhDeploy: existing.rhdhDeploy,
    eeBuild: existing.eeBuild,
    agentRuntimeBuild: existing.agentRuntimeBuild,
    agentSandboxServiceInstall: existing.agentSandboxServiceInstall,
    aapBootstrap: existing.aapBootstrap,
    openshellGatewayDeployment: existing.openshellGatewayDeployment,
  };

  fs.writeFileSync(existingPath, JSON.stringify(merged, null, 2));
  console.log("[seed-merge] Platform settings merged.");
}

function mergeSecrets(): void {
  if (!fs.existsSync(SEED_SECRETS_DIR)) return;

  const secrets: Record<string, string> = {};
  for (const name of fs.readdirSync(SEED_SECRETS_DIR)) {
    const content = fs.readFileSync(path.join(SEED_SECRETS_DIR, name), "utf8");
    if (content.trim()) {
      secrets[name] = content;
    }
  }

  if (Object.keys(secrets).length > 0) {
    importSecrets(secrets);
    console.log(`[seed-merge] Imported ${Object.keys(secrets).length} secret(s) into vault.`);
  }
}

function mergeCustomListings(): void {
  const listings: Record<string, string> = {};
  // Custom listing files are stored in the ConfigMap with a "custom-listing-"
  // prefix to distinguish them from the JSON config files.
  if (!fs.existsSync(SEED_CONFIG_DIR)) return;
  for (const name of fs.readdirSync(SEED_CONFIG_DIR)) {
    if (!name.startsWith("custom-listing-")) continue;
    const realName = name.replace("custom-listing-", "");
    const content = fs.readFileSync(path.join(SEED_CONFIG_DIR, name), "utf8");
    listings[realName] = content;
  }
  if (Object.keys(listings).length > 0) {
    writeCustomListings(listings);
    console.log(`[seed-merge] Imported ${Object.keys(listings).length} custom listing(s).`);
  }
}
