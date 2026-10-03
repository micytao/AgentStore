import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./secrets";

/**
 * Read/write helpers for the `.data/` files that need to be synced
 * between the local and on-cluster AgentStore instances.
 *
 * Each reader returns the raw JSON content (or empty default) so it
 * can be embedded into a ConfigMap or sync payload.  Each writer
 * accepts the same shape and persists to disk.
 */

// --- catalog-overrides.json ----------------------------------------------

export function readCatalogOverrides(): Record<string, unknown> {
  return readJsonFile("catalog-overrides.json", {});
}

export function writeCatalogOverrides(data: Record<string, unknown>): void {
  writeJsonFile("catalog-overrides.json", data);
}

// --- deleted-listings.json -----------------------------------------------

export function readDeletedListings(): string[] {
  return readJsonFile("deleted-listings.json", []);
}

export function writeDeletedListings(data: string[]): void {
  writeJsonFile("deleted-listings.json", data);
}

// --- providers.json ------------------------------------------------------

export function readProviders(): unknown[] {
  return readJsonFile("providers.json", []);
}

export function writeProviders(data: unknown[]): void {
  writeJsonFile("providers.json", data);
}

// --- custom-listings/ directory ------------------------------------------

/** Returns a map of filename → YAML content for all files in
 *  `.data/custom-listings/`. */
export function readCustomListings(): Record<string, string> {
  const dir = path.join(getDataDir(), "custom-listings");
  if (!fs.existsSync(dir)) return {};
  const result: Record<string, string> = {};
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    const content = fs.readFileSync(path.join(dir, name), "utf8");
    result[name] = content;
  }
  return result;
}

export function writeCustomListings(listings: Record<string, string>): void {
  const dir = path.join(getDataDir(), "custom-listings");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(listings)) {
    if (!/^[a-zA-Z0-9._-]+\.ya?ml$/.test(name)) continue;
    fs.writeFileSync(path.join(dir, name), content);
  }
}

// --- Generic helpers -----------------------------------------------------

function readJsonFile<T>(filename: string, fallback: T): T {
  const file = path.join(getDataDir(), filename);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filename: string, data: unknown): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
}
