import fs from "node:fs";
import path from "node:path";
import { callProvider as coreCallProvider, defaultBaseUrlFor } from "@agentstore/agent-core";
import type { CallOptions } from "@agentstore/agent-core";
import type {
  ModelResponse,
  ProviderConfig,
  ProviderKind,
  ProviderStatus,
} from "@agentstore/shared";
import { getSecret, hasSecret, previewSecret, setSecretRaw, clearSecretRaw } from "./secrets";

/**
 * Real model-provider registry. Configuration (kind, label, base URL,
 * default model) is stored in a local JSON file; the API key for each
 * provider is stored in the encrypted vault under `provider:{id}:apiKey`.
 *
 * The actual per-vendor network call (`callProvider`) lives in
 * @agentstore/agent-core, shared with the generic-chat runtime container —
 * this file only resolves config/vault state and hands off to it. `fetch`
 * only, no vendor SDKs, to keep the footprint small.
 */

function dataDir(): string {
  if (process.env.SECRETS_DATA_DIR) return process.env.SECRETS_DATA_DIR;
  const candidates = [
    path.resolve(process.cwd(), ".data"),
    path.resolve(process.cwd(), "../../.data"),
    path.resolve(__dirname, "../../../../.data"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

function configFilePath(): string {
  return path.join(dataDir(), "providers.json");
}

function keyFor(id: string): string {
  return `provider:${id}:apiKey`;
}

function store(): { configs: ProviderConfig[] } {
  const g = globalThis as typeof globalThis & {
    __agentStoreProviders?: { configs: ProviderConfig[] };
  };
  if (!g.__agentStoreProviders) {
    g.__agentStoreProviders = { configs: readConfigFile() };
  }
  return g.__agentStoreProviders;
}

function readConfigFile(): ProviderConfig[] {
  const file = configFilePath();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ProviderConfig[];
  } catch {
    return [];
  }
}

function writeConfigFile(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFilePath(), JSON.stringify(store().configs, null, 2));
}

interface CheckResult {
  models?: string[];
  lastChecked?: string;
  lastError?: string;
}

function checkResultStore(): Map<string, CheckResult> {
  const g = globalThis as typeof globalThis & {
    __agentStoreProviderChecks?: Map<string, CheckResult>;
  };
  if (!g.__agentStoreProviderChecks) {
    g.__agentStoreProviderChecks = new Map();
  }
  return g.__agentStoreProviderChecks;
}

function statusFor(config: ProviderConfig): ProviderStatus {
  const key = keyFor(config.id);
  const check = checkResultStore().get(config.id);
  return {
    ...config,
    hasKey: hasSecret(key),
    keyPreview: previewSecret(key),
    models: check?.models,
    lastChecked: check?.lastChecked,
    lastError: check?.lastError,
  };
}

export function listProviders(): ProviderStatus[] {
  return store().configs.map(statusFor);
}

export function getProvider(id: string): ProviderConfig | undefined {
  return store().configs.find((p) => p.id === id);
}

export function upsertProvider(
  input: Omit<ProviderConfig, "active"> & { active?: boolean }
): ProviderStatus {
  const configs = store().configs;
  const existing = configs.find((p) => p.id === input.id);
  const next: ProviderConfig = {
    id: input.id,
    kind: input.kind,
    label: input.label,
    baseUrl: input.baseUrl,
    defaultModel: input.defaultModel,
    active: existing?.active ?? false,
  };
  if (existing) {
    Object.assign(existing, next);
  } else {
    configs.push(next);
  }
  writeConfigFile();
  return statusFor(next);
}

export function deleteProvider(id: string): void {
  const configs = store().configs;
  const idx = configs.findIndex((p) => p.id === id);
  if (idx >= 0) configs.splice(idx, 1);
  clearSecretRaw(keyFor(id));
  writeConfigFile();
}

export function setProviderKey(id: string, value: string): ProviderStatus {
  const config = getProvider(id);
  if (!config) throw new Error(`Unknown provider: ${id}`);
  setSecretRaw(keyFor(id), value);
  return statusFor(config);
}

export function setActiveProvider(id: string): ProviderStatus {
  const configs = store().configs;
  const target = configs.find((p) => p.id === id);
  if (!target) throw new Error(`Unknown provider: ${id}`);
  for (const config of configs) config.active = config.id === id;
  writeConfigFile();
  return statusFor(target);
}

/** Self-hosted OpenAI-compatible servers (e.g. a local vLLM MaaS) typically
 * run with no auth at all, so an "active" openai-compatible provider
 * doesn't require a key the way a hosted vendor (Anthropic/OpenAI/Gemini)
 * does. */
export function getActiveProvider(): ProviderConfig | undefined {
  return store().configs.find(
    (p) => p.active && (p.kind === "openai-compatible" || hasSecret(keyFor(p.id)))
  );
}

/** Returns the stored key, if any, without requiring one — callers decide
 * whether a missing key is fatal based on the provider kind (see
 * requireApiKey). Exported for orchestrator.ts's specFrom(), which forwards
 * this to the Agent Sandbox Service so it can register an OpenShell
 * provider / set the sandbox's native provider env var — the console
 * itself never uses the key for anything beyond that single hand-off. */
export function apiKeyFor(id: string): string | undefined {
  return getSecret(keyFor(id));
}

/** Anthropic/OpenAI/Gemini always require a key; openai-compatible (which
 * covers self-hosted MaaS servers like vLLM, usually run without auth)
 * does not. */
function requireApiKey(id: string, kind: ProviderKind): string | undefined {
  const key = apiKeyFor(id);
  if (!key && kind !== "openai-compatible") {
    throw new Error(`No API key set for provider ${id}`);
  }
  return key;
}

/** Real network call per provider kind to confirm the key works and list models. */
export async function testProvider(id: string): Promise<ProviderStatus> {
  const config = getProvider(id);
  if (!config) throw new Error(`Unknown provider: ${id}`);
  const base = config.baseUrl || defaultBaseUrlFor(config.kind);
  const now = new Date().toISOString();

  try {
    const models = await listModels(config, base);
    checkResultStore().set(config.id, { models, lastChecked: now, lastError: undefined });
    return statusFor(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checkResultStore().set(config.id, { lastChecked: now, lastError: message });
    return statusFor(config);
  }
}

async function listModels(config: ProviderConfig, base: string): Promise<string[]> {
  const apiKey = requireApiKey(config.id, config.kind);
  switch (config.kind) {
    case "anthropic": {
      const res = await fetch(`${base}/models`, {
        headers: { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" },
      });
      if (!res.ok) throw new Error(`Anthropic /models failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => m.id);
    }
    case "openai":
    case "openai-compatible": {
      const res = await fetch(`${base}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) throw new Error(`/models failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => m.id);
    }
    case "gemini": {
      const res = await fetch(`${base}/models?key=${encodeURIComponent(apiKey ?? "")}`);
      if (!res.ok) throw new Error(`Gemini models failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { models?: { name: string }[] };
      return (body.models ?? []).map((m) => m.name.replace(/^models\//, ""));
    }
  }
}

export type { CallOptions };

/** Real chat/tool-call request against the active provider's vendor API —
 * resolves this provider's config + vault key, then delegates the actual
 * network call to @agentstore/agent-core's callProvider(). */
export async function callProvider(id: string, opts: CallOptions): Promise<ModelResponse> {
  const config = getProvider(id);
  if (!config) throw new Error(`Unknown provider: ${id}`);
  const apiKey = requireApiKey(config.id, config.kind);
  return coreCallProvider(
    { kind: config.kind, baseUrl: config.baseUrl, defaultModel: config.defaultModel, apiKey },
    opts
  );
}
