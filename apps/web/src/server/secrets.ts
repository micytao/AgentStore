import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SECRET_SLOTS, type SecretSummary } from "@agentstore/shared";

/**
 * Generic encrypted key/value vault backing the Admin "Secrets" tab as well
 * as the Providers and MCP admin features (which store API keys / header
 * tokens under their own namespaced keys, e.g. `provider:{id}:apiKey`).
 *
 * Values are encrypted at rest with AES-256-GCM using a key that is either
 * derived from SECRETS_ENCRYPTION_KEY or auto-generated on first run and
 * kept in a local, gitignored file. This is adequate for a local prototype;
 * it is not a substitute for a real secrets manager (see docs/DEFERRED.md).
 */

interface VaultEntry {
  iv: string;
  tag: string;
  data: string;
  updatedAt: string;
}

type VaultFile = Record<string, VaultEntry>;

function dataDir(): string {
  if (process.env.SECRETS_DATA_DIR) return process.env.SECRETS_DATA_DIR;
  const candidates = [
    path.resolve(process.cwd(), ".data"),
    path.resolve(process.cwd(), "../../.data"),
    path.resolve(__dirname, "../../../../.data"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

function vaultFilePath(): string {
  return path.join(dataDir(), "secrets.json");
}

function keyFilePath(): string {
  return path.join(dataDir(), "secrets.key");
}

function ensureDataDir(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let cachedKey: Buffer | null = null;

function loadEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  if (process.env.SECRETS_ENCRYPTION_KEY) {
    cachedKey = crypto.scryptSync(
      process.env.SECRETS_ENCRYPTION_KEY,
      "agentstore-secrets-vault",
      32
    );
    return cachedKey;
  }

  ensureDataDir();
  const file = keyFilePath();
  if (fs.existsSync(file)) {
    cachedKey = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
    return cachedKey;
  }

  const generated = crypto.randomBytes(32);
  fs.writeFileSync(file, generated.toString("hex"), { mode: 0o600 });
  console.warn(
    "[secrets] No SECRETS_ENCRYPTION_KEY set. Generated a local vault key at " +
      file +
      ". Set SECRETS_ENCRYPTION_KEY explicitly for any non-local deployment."
  );
  cachedKey = generated;
  return cachedKey;
}

function vaultStore(): { data: VaultFile } {
  const g = globalThis as typeof globalThis & {
    __agentStoreVault?: { data: VaultFile };
  };
  if (!g.__agentStoreVault) {
    g.__agentStoreVault = { data: readVaultFile() };
  }
  return g.__agentStoreVault;
}

function readVaultFile(): VaultFile {
  const file = vaultFilePath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as VaultFile;
  } catch {
    return {};
  }
}

function writeVaultFile(): void {
  ensureDataDir();
  fs.writeFileSync(
    vaultFilePath(),
    JSON.stringify(vaultStore().data, null, 2),
    { mode: 0o600 }
  );
}

function encrypt(plaintext: string): Omit<VaultEntry, "updatedAt"> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", loadEncryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: data.toString("hex"),
  };
}

function decrypt(entry: VaultEntry): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    loadEncryptionKey(),
    Buffer.from(entry.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
  const data = Buffer.concat([
    decipher.update(Buffer.from(entry.data, "hex")),
    decipher.final(),
  ]);
  return data.toString("utf8");
}

// --- Low-level generic API, used by providers.ts / mcp.ts too ---

export function hasSecret(key: string): boolean {
  return Boolean(vaultStore().data[key]);
}

export function getSecret(key: string): string | undefined {
  const entry = vaultStore().data[key];
  if (!entry) return undefined;
  try {
    return decrypt(entry);
  } catch {
    return undefined;
  }
}

export function previewSecret(key: string): string | undefined {
  const value = getSecret(key);
  if (!value) return undefined;
  const tail = value.slice(-4);
  return `••••${tail}`;
}

export function secretUpdatedAt(key: string): string | undefined {
  return vaultStore().data[key]?.updatedAt;
}

export function setSecretRaw(key: string, value: string): void {
  const entry: VaultEntry = { ...encrypt(value), updatedAt: new Date().toISOString() };
  vaultStore().data[key] = entry;
  writeVaultFile();
}

export function clearSecretRaw(key: string): void {
  delete vaultStore().data[key];
  writeVaultFile();
}

// --- Secrets-tab API, fixed slots only ---

function summaryFor(key: string): SecretSummary {
  const slot = SECRET_SLOTS.find((s) => s.key === key);
  if (!slot) throw new Error(`Unknown secret key: ${key}`);
  const inVault = hasSecret(key);
  const inEnv = Boolean(process.env[key]);
  return {
    ...slot,
    hasValue: inVault || inEnv,
    preview: inVault ? previewSecret(key) : inEnv ? "••••(env)" : undefined,
    updatedAt: secretUpdatedAt(key),
    source: inVault ? "vault" : inEnv ? "env" : "none",
  };
}

export function listSecretSummaries(): SecretSummary[] {
  return SECRET_SLOTS.map((slot) => summaryFor(slot.key));
}

export function setSecret(key: string, value: string): SecretSummary {
  if (!SECRET_SLOTS.some((s) => s.key === key)) {
    throw new Error(`Unknown secret key: ${key}`);
  }
  setSecretRaw(key, value);
  process.env[key] = value;
  return summaryFor(key);
}

export function clearSecret(key: string): SecretSummary {
  if (!SECRET_SLOTS.some((s) => s.key === key)) {
    throw new Error(`Unknown secret key: ${key}`);
  }
  clearSecretRaw(key);
  delete process.env[key];
  return summaryFor(key);
}

// Hydrate process.env for the fixed engine-related slots on module load so
// engine-openshell's `env: { ...process.env }` spread picks them up with no
// changes needed in that package.
for (const slot of SECRET_SLOTS) {
  if (hasSecret(slot.key)) {
    process.env[slot.key] = getSecret(slot.key);
  }
}
