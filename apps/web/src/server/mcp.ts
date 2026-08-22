import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  McpServerConfig,
  McpServerStatus,
  McpToolInfo,
  ModelTool,
} from "@agentstore/shared";
import { getSecret, hasSecret, setSecretRaw, clearSecretRaw } from "./secrets";

/**
 * Real MCP client manager. Server configs (transport, command/url) persist
 * to a local JSON file; connections are live `Client` instances kept in a
 * globalThis-scoped map so they survive across requests (and Next.js dev
 * hot-reloads) without reconnecting every time.
 *
 * `stdio` transport spawns a local process chosen by whoever has Admin
 * access — this is inherent to MCP and is called out in the Admin UI.
 */

interface StoredServer extends McpServerConfig {
  toolEnabled: Record<string, boolean>;
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

function configFilePath(): string {
  return path.join(dataDir(), "mcp-servers.json");
}

function authTokenKey(id: string): string {
  return `mcp:${id}:authToken`;
}

interface LiveConnection {
  client: Client;
  tools: McpToolInfo[];
  connectionState: McpServerStatus["connectionState"];
  lastError?: string;
}

function store(): { configs: StoredServer[]; live: Map<string, LiveConnection> } {
  const g = globalThis as typeof globalThis & {
    __agentStoreMcp?: { configs: StoredServer[]; live: Map<string, LiveConnection> };
  };
  if (!g.__agentStoreMcp) {
    g.__agentStoreMcp = { configs: readConfigFile(), live: new Map() };
  }
  return g.__agentStoreMcp;
}

function readConfigFile(): StoredServer[] {
  const file = configFilePath();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as StoredServer[];
  } catch {
    return [];
  }
}

function writeConfigFile(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFilePath(), JSON.stringify(store().configs, null, 2));
}

function statusFor(config: StoredServer): McpServerStatus {
  const live = store().live.get(config.id);
  const tools = (live?.tools ?? []).map((tool) => ({
    ...tool,
    enabled: config.toolEnabled[tool.name] ?? false,
  }));
  return {
    id: config.id,
    name: config.name,
    transport: config.transport,
    command: config.command,
    args: config.args,
    url: config.url,
    enabled: config.enabled,
    hasAuthToken: hasSecret(authTokenKey(config.id)),
    connectionState: live?.connectionState ?? "disconnected",
    lastError: live?.lastError,
    tools,
  };
}

export function listMcpServers(): McpServerStatus[] {
  return store().configs.map(statusFor);
}

export function getMcpServer(id: string): StoredServer | undefined {
  return store().configs.find((s) => s.id === id);
}

export function upsertMcpServer(
  input: Omit<McpServerConfig, "enabled"> & { enabled?: boolean }
): McpServerStatus {
  const configs = store().configs;
  const existing = configs.find((s) => s.id === input.id);
  const next: StoredServer = {
    id: input.id,
    name: input.name,
    transport: input.transport,
    command: input.command,
    args: input.args,
    url: input.url,
    enabled: input.enabled ?? existing?.enabled ?? true,
    toolEnabled: existing?.toolEnabled ?? {},
  };
  if (existing) {
    Object.assign(existing, next);
  } else {
    configs.push(next);
  }
  writeConfigFile();
  return statusFor(next);
}

export async function deleteMcpServer(id: string): Promise<void> {
  await disconnectServer(id);
  const configs = store().configs;
  const idx = configs.findIndex((s) => s.id === id);
  if (idx >= 0) configs.splice(idx, 1);
  clearSecretRaw(authTokenKey(id));
  writeConfigFile();
}

export function setMcpAuthToken(id: string, value: string): McpServerStatus {
  const config = getMcpServer(id);
  if (!config) throw new Error(`Unknown MCP server: ${id}`);
  setSecretRaw(authTokenKey(id), value);
  return statusFor(config);
}

async function disconnectServer(id: string): Promise<void> {
  const live = store().live.get(id);
  if (!live) return;
  try {
    await live.client.close();
  } catch {
    /* ignore */
  }
  store().live.delete(id);
}

function buildTransport(config: StoredServer): Transport {
  const authToken = getSecret(authTokenKey(config.id));
  switch (config.transport) {
    case "stdio": {
      if (!config.command) throw new Error("stdio server requires a command");
      return new StdioClientTransport({ command: config.command, args: config.args ?? [] });
    }
    case "streamable-http": {
      if (!config.url) throw new Error("streamable-http server requires a url");
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined,
      });
    }
    case "sse": {
      if (!config.url) throw new Error("sse server requires a url");
      return new SSEClientTransport(new URL(config.url), {
        requestInit: authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined,
      });
    }
  }
}

/** Real MCP handshake: connects, runs listTools(), and stores the live client. */
export async function connectServer(id: string): Promise<McpServerStatus> {
  const config = getMcpServer(id);
  if (!config) throw new Error(`Unknown MCP server: ${id}`);

  await disconnectServer(id);

  try {
    const client = new Client({ name: "agentstore", version: "0.1.0" });
    const transport = buildTransport(config);
    await client.connect(transport);
    const { tools } = await client.listTools();
    const toolInfos: McpToolInfo[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      enabled: config.toolEnabled[t.name] ?? false,
    }));
    store().live.set(id, { client, tools: toolInfos, connectionState: "connected" });
    return statusFor(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store().live.set(id, { client: null as unknown as Client, tools: [], connectionState: "error", lastError: message });
    return statusFor(config);
  }
}

export async function disconnectMcpServer(id: string): Promise<McpServerStatus> {
  const config = getMcpServer(id);
  if (!config) throw new Error(`Unknown MCP server: ${id}`);
  await disconnectServer(id);
  return statusFor(config);
}

export function setToolEnabled(id: string, toolName: string, enabled: boolean): McpServerStatus {
  const config = getMcpServer(id);
  if (!config) throw new Error(`Unknown MCP server: ${id}`);
  config.toolEnabled[toolName] = enabled;
  writeConfigFile();
  const live = store().live.get(id);
  if (live) {
    const tool = live.tools.find((t) => t.name === toolName);
    if (tool) tool.enabled = enabled;
  }
  return statusFor(config);
}

/** Flattened, connected + enabled tools, used internally by drafting.ts. */
export function listEnabledTools(): ModelTool[] {
  const out: ModelTool[] = [];
  for (const config of store().configs) {
    if (!config.enabled) continue;
    const live = store().live.get(config.id);
    if (!live || live.connectionState !== "connected") continue;
    for (const tool of live.tools) {
      if (config.toolEnabled[tool.name]) {
        out.push({ serverId: config.id, name: tool.name, description: tool.description });
      }
    }
  }
  return out;
}

export async function callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<string> {
  const live = store().live.get(serverId);
  if (!live || live.connectionState !== "connected") {
    throw new Error(`MCP server ${serverId} is not connected`);
  }
  const result = await live.client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string }[] | undefined;
  return (content ?? [])
    .map((block) => (block.type === "text" ? block.text ?? "" : JSON.stringify(block)))
    .join("\n");
}
