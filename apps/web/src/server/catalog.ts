import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { Listing, ListingUpdate } from "@agentstore/shared";

function catalogDir(): string {
  if (process.env.CATALOG_DIR) return process.env.CATALOG_DIR;
  const candidates = [
    path.resolve(process.cwd(), "../../catalog/listings"),
    path.resolve(process.cwd(), "catalog/listings"),
    path.resolve(__dirname, "../../../../catalog/listings"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

let cache: Listing[] | null = null;

/**
 * Admin edits made from the Admin console for this prototype live in memory
 * only (no rewrite of the YAML source files) and are layered on top of the
 * catalog on every read, mirroring the in-memory task store in orchestrator.ts.
 */
type OverrideStore = { overrides: Map<string, ListingUpdate> };

function overrideStore(): OverrideStore {
  const g = globalThis as typeof globalThis & { __agentStoreCatalog?: OverrideStore };
  if (!g.__agentStoreCatalog) {
    g.__agentStoreCatalog = { overrides: new Map() };
  }
  return g.__agentStoreCatalog;
}

function applyOverride(listing: Listing): Listing {
  const override = overrideStore().overrides.get(listing.id);
  return override ? { ...listing, ...override } : listing;
}

function loadBaseListings(): Listing[] {
  if (cache) return cache;
  const dir = catalogDir();
  if (!fs.existsSync(dir)) {
    throw new Error(`Catalog directory not found: ${dir}`);
  }
  const listings: Listing[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    listings.push(yaml.load(raw) as Listing);
  }
  cache = listings.sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export function loadListings(): Listing[] {
  return loadBaseListings().map(applyOverride);
}

export function getListing(id: string): Listing | undefined {
  const listing = loadBaseListings().find((item) => item.id === id);
  return listing ? applyOverride(listing) : undefined;
}

export function updateListing(id: string, patch: ListingUpdate): Listing | undefined {
  const base = loadBaseListings().find((item) => item.id === id);
  if (!base) return undefined;
  const current = overrideStore().overrides.get(id) ?? {};
  overrideStore().overrides.set(id, { ...current, ...patch });
  return applyOverride(base);
}
