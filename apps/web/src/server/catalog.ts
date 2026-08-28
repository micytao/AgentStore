import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";
import type { Listing, ListingCreateInput, ListingUpdate } from "@agentstore/shared";

/**
 * Two catalog sources are merged:
 *  - `catalog/listings/*.yaml` — the git-tracked, shipped demo catalog.
 *    Admin edits to these are layered on top as an in-memory override (see
 *    docs/DEFERRED.md — persisted to .data/catalog-overrides.json).
 *  - a writable "custom" directory (default `.data/custom-listings`,
 *    override with CUSTOM_CATALOG_DIR) — agents created through the Admin
 *    onboarding wizard. These are real YAML files, written and rewritten
 *    directly on create/update/delete, so they need no override layer.
 */

function builtinDir(): string {
  if (process.env.CATALOG_DIR) return process.env.CATALOG_DIR;
  const candidates = [
    path.resolve(process.cwd(), "../../catalog/listings"),
    path.resolve(process.cwd(), "catalog/listings"),
    path.resolve(__dirname, "../../../../catalog/listings"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

function dataDir(): string {
  if (process.env.SECRETS_DATA_DIR) return process.env.SECRETS_DATA_DIR;
  const candidates = [
    path.resolve(process.cwd(), ".data"),
    path.resolve(process.cwd(), "../../.data"),
    path.resolve(__dirname, "../../../../.data"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

function customDir(): string {
  if (process.env.CUSTOM_CATALOG_DIR) return process.env.CUSTOM_CATALOG_DIR;
  return path.join(dataDir(), "custom-listings");
}

function overridesFilePath(): string {
  return path.join(dataDir(), "catalog-overrides.json");
}

function deletedIdsFilePath(): string {
  return path.join(dataDir(), "deleted-listings.json");
}

function loadDeletedIdsFromDisk(): Set<string> {
  const file = deletedIdsFilePath();
  if (!fs.existsSync(file)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as string[];
    return new Set(raw);
  } catch {
    return new Set();
  }
}

function persistDeletedIds(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    deletedIdsFilePath(),
    JSON.stringify([...deletedIdsStore().ids], null, 2)
  );
}

// --- Built-in listing deletions (soft delete; the shipped YAML stays on
// disk untouched, the id is just hidden from loadListings()/getListing()) ---

type DeletedIdsStore = { ids: Set<string> };

function deletedIdsStore(): DeletedIdsStore {
  const g = globalThis as typeof globalThis & {
    __agentStoreDeletedListings?: DeletedIdsStore;
  };
  if (!g.__agentStoreDeletedListings) {
    g.__agentStoreDeletedListings = { ids: loadDeletedIdsFromDisk() };
  }
  return g.__agentStoreDeletedListings;
}

function loadOverridesFromDisk(): Map<string, ListingUpdate> {
  const file = overridesFilePath();
  if (!fs.existsSync(file)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, ListingUpdate>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

function persistOverrides(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const obj: Record<string, ListingUpdate> = {};
  for (const [id, patch] of overrideStore().overrides) obj[id] = patch;
  fs.writeFileSync(overridesFilePath(), JSON.stringify(obj, null, 2));
}

interface LoadedCatalog {
  listings: Listing[];
  /** id -> absolute file path, for custom listings only (built-in ones are edit-only). */
  customFilePaths: Map<string, string>;
}

let cache: LoadedCatalog | null = null;

function readYamlListings(dir: string, source: Listing["source"]): { listing: Listing; file: string }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { listing: Listing; file: string }[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    const filePath = path.join(dir, file);
    const raw = fs.readFileSync(filePath, "utf8");
    const listing = yaml.load(raw) as Listing;
    listing.source = source;
    out.push({ listing, file: filePath });
  }
  return out;
}

function loadCatalog(): LoadedCatalog {
  if (cache) return cache;

  const builtinLoaded = readYamlListings(builtinDir(), "built-in");
  if (builtinLoaded.length === 0 && !fs.existsSync(builtinDir())) {
    throw new Error(`Catalog directory not found: ${builtinDir()}`);
  }
  const customLoaded = readYamlListings(customDir(), "custom");

  const customFilePaths = new Map<string, string>();
  for (const { listing, file } of customLoaded) {
    customFilePaths.set(listing.id, file);
  }

  const departmentOrder: Record<string, number> = {
    support: 0,
    finance: 1,
    data: 2,
    security: 3,
    engineering: 4,
  };
  const listings = [...builtinLoaded, ...customLoaded]
    .map((entry) => entry.listing)
    .sort((a, b) => {
      const da = departmentOrder[a.department] ?? 99;
      const db = departmentOrder[b.department] ?? 99;
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });

  cache = { listings, customFilePaths };
  return cache;
}

function invalidateCache(): void {
  cache = null;
}

// --- Built-in listing overrides (in-memory; persisted in Phase "file-durability") ---

type OverrideStore = { overrides: Map<string, ListingUpdate> };

function overrideStore(): OverrideStore {
  const g = globalThis as typeof globalThis & { __agentStoreCatalog?: OverrideStore };
  if (!g.__agentStoreCatalog) {
    g.__agentStoreCatalog = { overrides: loadOverridesFromDisk() };
  }
  return g.__agentStoreCatalog;
}

function applyOverride(listing: Listing): Listing {
  const override = overrideStore().overrides.get(listing.id);
  if (!override) return listing;
  const agentConfig = override.agentConfig
    ? { ...listing.agentConfig, ...override.agentConfig }
    : listing.agentConfig;
  return { ...listing, ...override, agentConfig };
}

export function loadListings(): Listing[] {
  const deleted = deletedIdsStore().ids;
  return loadCatalog()
    .listings.filter((listing) => !deleted.has(listing.id))
    .map(applyOverride);
}

export function getListing(id: string): Listing | undefined {
  if (deletedIdsStore().ids.has(id)) return undefined;
  const listing = loadCatalog().listings.find((item) => item.id === id);
  return listing ? applyOverride(listing) : undefined;
}

/** Patches an existing listing. Built-in listings are patched via the
 * in-memory override layer; custom (wizard-created) listings are patched
 * in place and rewritten to their YAML file — both end up reflected by
 * loadListings()/getListing() immediately either way. */
export function updateListing(id: string, patch: ListingUpdate): Listing | undefined {
  const base = loadCatalog().listings.find((item) => item.id === id);
  if (!base) return undefined;

  if (base.source === "custom") {
    const filePath = loadCatalog().customFilePaths.get(id);
    if (!filePath) return undefined;
    const agentConfig = patch.agentConfig ? { ...base.agentConfig, ...patch.agentConfig } : base.agentConfig;
    const updated: Listing = { ...base, ...patch, agentConfig, source: "custom" };
    writeCustomListingFile(filePath, updated);
    invalidateCache();
    return getListing(id);
  }

  const current = overrideStore().overrides.get(id) ?? {};
  const agentConfig = patch.agentConfig
    ? { ...(current.agentConfig ?? base.agentConfig), ...patch.agentConfig }
    : current.agentConfig;
  overrideStore().overrides.set(id, { ...current, ...patch, agentConfig });
  persistOverrides();
  return applyOverride(base);
}

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "agent"
  );
}

function uniqueId(label: string): string {
  const base = slugify(label);
  const existingIds = new Set(loadCatalog().listings.map((l) => l.id));
  if (!existingIds.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function writeCustomListingFile(filePath: string, listing: Listing): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // `source` is derived at load time, not part of the persisted YAML.
  // skipInvalid drops undefined-valued optional fields instead of throwing.
  const { source: _source, ...persisted } = listing;
  fs.writeFileSync(filePath, yaml.dump(persisted, { skipInvalid: true }));
}

/** Creates a brand-new agent from the Admin onboarding wizard. Writes a
 * real YAML file into the writable custom-listings directory (see
 * customDir()) so it survives restarts without needing a database. */
export function createListing(input: ListingCreateInput): Listing {
  const id = uniqueId(input.name);
  const reviewStatus = input.publish ? "published" : "draft";
  const listing: Listing = {
    id,
    name: input.name,
    department: input.department,
    category: input.category,
    description: input.description,
    icon: input.icon,
    engineType: input.engineType,
    supportedModes: input.supportedModes,
    riskTier: input.riskTier,
    reviewStatus,
    pricing: input.pricing,
    openshellAgent: input.openshellAgent,
    runtime: input.runtime,
    agentConfig: input.agentConfig,
  };

  const filePath = path.join(customDir(), `${id}.yaml`);
  writeCustomListingFile(filePath, { ...listing, source: "custom" });
  invalidateCache();
  return getListing(id)!;
}

/** Deletes a listing. Custom (wizard-created) listings have their YAML
 * file removed outright. Built-in listings ship in the repo, so they're
 * soft-deleted instead — the shipped file is left untouched and the id is
 * just added to a tombstone list that hides it from loadListings()/
 * getListing() going forward. */
export function deleteListing(id: string): void {
  const base = loadCatalog().listings.find((item) => item.id === id);
  if (!base) throw new Error(`Unknown listing: ${id}`);

  if (base.source === "custom") {
    const filePath = loadCatalog().customFilePaths.get(id);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } else {
    deletedIdsStore().ids.add(id);
    persistDeletedIds();
  }

  overrideStore().overrides.delete(id);
  persistOverrides();
  invalidateCache();
}
