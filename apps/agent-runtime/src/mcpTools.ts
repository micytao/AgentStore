import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callMcpTool, connectMcpClient } from "@agentstore/agent-core";
import type { ModelTool, OpenShellMcpServerConfig } from "@agentstore/shared";
import { logError, logInfo, logWarn } from "./log";

/**
 * Unlike the console (apps/web/src/server/mcp.ts), this runtime has no
 * admin UI or persistence of its own — it just connects, at startup, to
 * whatever MCP servers were baked into its mounted config.json and keeps
 * those connections for the life of the pod. A server that fails to
 * connect is skipped (logged, not fatal) so one misconfigured MCP server
 * doesn't take the whole chat agent down.
 */

interface Connected {
  config: OpenShellMcpServerConfig;
  client: Client;
  tools: ModelTool[];
}

let connections: Map<string, Connected> | null = null;

export async function connectConfiguredServers(servers: OpenShellMcpServerConfig[]): Promise<void> {
  const map = new Map<string, Connected>();
  for (const server of servers) {
    try {
      const { client, tools } = await connectMcpClient({
        id: server.id,
        name: server.name,
        transport: server.transport,
        url: server.url,
        authToken: server.authToken,
      });
      map.set(server.id, {
        config: server,
        client,
        tools: tools.map((t) => ({ serverId: server.id, name: t.name, description: t.description })),
      });
      logInfo(`Connected MCP server "${server.name}"`, { serverId: server.id, tools: tools.map((t) => t.name) });
    } catch (err) {
      // Not fatal — one misconfigured MCP server shouldn't take the whole
      // chat agent down — but this is exactly the kind of failure an admin
      // needs to see in `oc logs` after "why doesn't my agent have tools?".
      logError(`Failed to connect MCP server "${server.name}"`, err, { serverId: server.id, url: server.url });
    }
  }
  connections = map;
  if (servers.length === 0) logInfo("No MCP servers configured");
}

export function listTools(): ModelTool[] {
  const out: ModelTool[] = [];
  for (const connected of (connections ?? new Map()).values()) {
    out.push(...connected.tools);
  }
  return out;
}

export async function callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<string> {
  const connected = connections?.get(serverId);
  if (!connected) {
    logWarn(`Tool call for "${name}" targets MCP server "${serverId}", which is not connected`);
    throw new Error(`MCP server ${serverId} is not connected`);
  }
  const startedAt = Date.now();
  try {
    const result = await callMcpTool(connected.client, name, args);
    logInfo(`Tool "${name}" on "${serverId}" succeeded`, { durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    // chatLoop.ts catches this and turns it into a "Tool call failed: ..."
    // message fed back to the model, so without this log line a tool
    // failure is invisible outside of the model's own reply.
    logError(`Tool "${name}" on "${serverId}" failed`, err, { args, durationMs: Date.now() - startedAt });
    throw err;
  }
}
