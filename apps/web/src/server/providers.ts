import fs from "node:fs";
import path from "node:path";
import type {
  ModelMessage,
  ModelResponse,
  ModelTool,
  ModelToolCall,
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
 * `testProvider` and `callProvider` make real network calls to the vendor
 * APIs via plain `fetch` — no vendor SDKs are added to keep the footprint
 * small.
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

export function getActiveProvider(): ProviderConfig | undefined {
  return store().configs.find((p) => p.active && hasSecret(keyFor(p.id)));
}

function apiKeyFor(id: string): string {
  const key = getSecret(keyFor(id));
  if (!key) throw new Error(`No API key set for provider ${id}`);
  return key;
}

function defaultBaseUrl(kind: ProviderKind): string {
  switch (kind) {
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "openai-compatible":
      return "https://api.openai.com/v1";
  }
}

/** Real network call per provider kind to confirm the key works and list models. */
export async function testProvider(id: string): Promise<ProviderStatus> {
  const config = getProvider(id);
  if (!config) throw new Error(`Unknown provider: ${id}`);
  const base = config.baseUrl || defaultBaseUrl(config.kind);
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
  const apiKey = apiKeyFor(config.id);
  switch (config.kind) {
    case "anthropic": {
      const res = await fetch(`${base}/models`, {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      });
      if (!res.ok) throw new Error(`Anthropic /models failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => m.id);
    }
    case "openai":
    case "openai-compatible": {
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`/models failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => m.id);
    }
    case "gemini": {
      const res = await fetch(`${base}/models?key=${encodeURIComponent(apiKey)}`);
      if (!res.ok) throw new Error(`Gemini models failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { models?: { name: string }[] };
      return (body.models ?? []).map((m) => m.name.replace(/^models\//, ""));
    }
  }
}

interface CallOptions {
  system: string;
  messages: ModelMessage[];
  tools: ModelTool[];
}

/** Real chat/tool-call request against the active provider's vendor API. */
export async function callProvider(id: string, opts: CallOptions): Promise<ModelResponse> {
  const config = getProvider(id);
  if (!config) throw new Error(`Unknown provider: ${id}`);
  const base = config.baseUrl || defaultBaseUrl(config.kind);
  const model = config.defaultModel || fallbackModel(config.kind);

  switch (config.kind) {
    case "anthropic":
      return callAnthropic(config, base, model, opts);
    case "openai":
    case "openai-compatible":
      return callOpenAiCompatible(config, base, model, opts);
    case "gemini":
      return callGemini(config, base, model, opts);
  }
}

function fallbackModel(kind: ProviderKind): string {
  switch (kind) {
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "openai":
    case "openai-compatible":
      return "gpt-4o-mini";
    case "gemini":
      return "gemini-1.5-flash";
  }
}

async function callAnthropic(
  config: ProviderConfig,
  base: string,
  model: string,
  opts: CallOptions
): Promise<ModelResponse> {
  const apiKey = apiKeyFor(config.id);
  const body: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    system: opts.system,
    messages: opts.messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  };
  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema ?? { type: "object", properties: {} },
    }));
  }

  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic /messages failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    content: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
  };

  const toolCalls: ModelToolCall[] = [];
  let text = "";
  for (const block of data.content ?? []) {
    if (block.type === "text" && block.text) text += block.text;
    if (block.type === "tool_use" && block.name) {
      const tool = opts.tools.find((t) => t.name === block.name);
      toolCalls.push({ serverId: tool?.serverId ?? "", name: block.name, args: block.input ?? {} });
    }
  }
  return toolCalls.length > 0 ? { toolCalls } : { text };
}

async function callOpenAiCompatible(
  config: ProviderConfig,
  base: string,
  model: string,
  opts: CallOptions
): Promise<ModelResponse> {
  const apiKey = apiKeyFor(config.id);
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: opts.system },
      ...opts.messages.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content,
      })),
    ],
  };
  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema ?? { type: "object", properties: {} },
      },
    }));
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`/chat/completions failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string;
        tool_calls?: { function: { name: string; arguments: string } }[];
      };
    }[];
  };
  const message = data.choices?.[0]?.message;
  if (message?.tool_calls?.length) {
    const toolCalls: ModelToolCall[] = message.tool_calls.map((call) => {
      const tool = opts.tools.find((t) => t.name === call.function.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* ignore malformed args */
      }
      return { serverId: tool?.serverId ?? "", name: call.function.name, args };
    });
    return { toolCalls };
  }
  return { text: message?.content ?? "" };
}

async function callGemini(
  config: ProviderConfig,
  base: string,
  model: string,
  opts: CallOptions
): Promise<ModelResponse> {
  const apiKey = apiKeyFor(config.id);
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: opts.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
  if (opts.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema ?? { type: "object", properties: {} },
        })),
      },
    ];
  }

  const res = await fetch(
    `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`Gemini generateContent failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string; functionCall?: { name: string; args: Record<string, unknown> } }[] };
    }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const toolCalls: ModelToolCall[] = [];
  let text = "";
  for (const part of parts) {
    if (part.text) text += part.text;
    if (part.functionCall) {
      const tool = opts.tools.find((t) => t.name === part.functionCall!.name);
      toolCalls.push({
        serverId: tool?.serverId ?? "",
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      });
    }
  }
  return toolCalls.length > 0 ? { toolCalls } : { text };
}
