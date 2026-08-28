import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpTransport } from "@agentstore/shared";

/**
 * Minimal connect/listTools/callTool MCP client, extracted from the
 * live-connection half of apps/web/src/server/mcp.ts (buildTransport,
 * connectServer, callTool). The admin-only persistence/CRUD/tool-enable
 * bits stay in mcp.ts, which now delegates the actual protocol work here —
 * the same functions the generic-chat runtime container uses directly
 * (it has no admin UI or config store of its own).
 */

export interface McpServerRef {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  authToken?: string;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
}

export function buildMcpTransport(ref: McpServerRef): Transport {
  switch (ref.transport) {
    case "stdio": {
      if (!ref.command) throw new Error("stdio server requires a command");
      return new StdioClientTransport({ command: ref.command, args: ref.args ?? [] });
    }
    case "streamable-http": {
      if (!ref.url) throw new Error("streamable-http server requires a url");
      return new StreamableHTTPClientTransport(new URL(ref.url), {
        requestInit: ref.authToken ? { headers: { Authorization: `Bearer ${ref.authToken}` } } : undefined,
      });
    }
    case "sse": {
      if (!ref.url) throw new Error("sse server requires a url");
      return new SSEClientTransport(new URL(ref.url), {
        requestInit: ref.authToken ? { headers: { Authorization: `Bearer ${ref.authToken}` } } : undefined,
      });
    }
  }
}

export async function connectMcpClient(
  ref: McpServerRef
): Promise<{ client: Client; tools: McpToolDescriptor[] }> {
  const client = new Client({ name: "agentstore", version: "0.1.0" });
  const transport = buildMcpTransport(ref);
  await client.connect(transport);
  const { tools } = await client.listTools();
  return { client, tools: tools.map((t) => ({ name: t.name, description: t.description })) };
}

export async function callMcpTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string }[] | undefined;
  return (content ?? [])
    .map((block) => (block.type === "text" ? block.text ?? "" : JSON.stringify(block)))
    .join("\n");
}
