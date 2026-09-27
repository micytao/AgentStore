import fs from "node:fs";
import type { GenericAgentRuntimeConfig, ProviderKind } from "@agentstore/shared";
import type { ProviderCallConfig } from "@agentstore/agent-core";
import { logInfo, logWarn } from "./log";

/**
 * Hybrid config delivery (see the plan's "Alternatives considered" note):
 * flat scalars — provider kind/base URL/model/key, listing name — come in
 * as env vars (the sensitive ones sourced from a Secret via secretKeyRef,
 * same convention as OPENSHELL_SERVICE_TOKEN in agent-sandbox-service.yaml);
 * the structured, variable-length parts — persona intro lines, skills
 * (with full instructions, for `load_skill` to resolve), and MCP servers —
 * come from a mounted Secret-backed JSON file, written by
 * ansible/provision-generic-agent.yml, matching the opencodeConfig.ts
 * convention already used for the OpenShell path.
 */

export interface RuntimeConfig {
  listingName: string;
  introLines: string[];
  skills: GenericAgentRuntimeConfig["skills"];
  mcpServers: GenericAgentRuntimeConfig["mcpServers"];
  provider: ProviderCallConfig;
}

export function port(): number {
  const raw = process.env.PORT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 8080;
}

function configFilePath(): string {
  return process.env.AGENT_CONFIG_FILE || "/etc/agent/config.json";
}

function readMountedConfig(): GenericAgentRuntimeConfig {
  const file = configFilePath();
  if (!fs.existsSync(file)) {
    logWarn(`No config file at ${file} — running with an empty persona/skills/MCP config`, {
      hint: "Set AGENT_CONFIG_FILE to point at one for local testing",
    });
    return { listingName: process.env.LISTING_NAME || "Agent", introLines: [], skills: [], mcpServers: [] };
  }
  const raw = fs.readFileSync(file, "utf8");
  let parsed: GenericAgentRuntimeConfig;
  try {
    parsed = JSON.parse(raw) as GenericAgentRuntimeConfig;
  } catch (err) {
    // Fail loudly and immediately rather than limping along with an empty
    // config that would silently drop every skill/MCP server the admin
    // configured — a malformed mount is almost always a provisioning bug.
    throw new Error(`Config file at ${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  logInfo("Loaded mounted config", {
    file,
    listingName: parsed.listingName,
    introLines: parsed.introLines?.length ?? 0,
    skills: (parsed.skills ?? []).map((s) => s.id),
    mcpServers: (parsed.mcpServers ?? []).map((s) => s.id),
  });
  return parsed;
}

let cached: RuntimeConfig | null = null;

export function loadConfig(): RuntimeConfig {
  if (cached) return cached;
  const mounted = readMountedConfig();
  cached = {
    listingName: process.env.LISTING_NAME || mounted.listingName || "Agent",
    introLines: mounted.introLines ?? [],
    skills: mounted.skills ?? [],
    mcpServers: mounted.mcpServers ?? [],
    provider: {
      kind: (process.env.PROVIDER_KIND as ProviderKind | undefined) ?? "openai-compatible",
      baseUrl: process.env.PROVIDER_BASE_URL || undefined,
      defaultModel: process.env.PROVIDER_DEFAULT_MODEL || undefined,
      apiKey: process.env.PROVIDER_API_KEY || undefined,
    },
  };
  // Never log the API key itself — just enough to confirm "did the right
  // provider/model/URL actually make it into this pod" without a shell.
  logInfo("Resolved provider config", {
    kind: cached.provider.kind,
    baseUrl: cached.provider.baseUrl ?? "(default)",
    model: cached.provider.defaultModel ?? "(default)",
    apiKeySet: Boolean(cached.provider.apiKey),
  });
  return cached;
}
