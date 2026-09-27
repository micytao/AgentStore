import type { Listing, OpenShellMcpServerConfig, OpenShellModelConfig } from "@agentstore/shared";
import { getMcpAuthToken, getMcpServer, listMcpServers } from "./mcp";
import { apiKeyFor, providerFor } from "./providers";

/** Resolves the model credentials a deployed agent needs, as plain data —
 * used both for the generic-chat AAP deploy (deployments.ts) and the
 * OpenShell sandbox deploy (openshellDeploy.ts). The console resolves
 * *which* provider (providers.ts's providerFor()); the receiving side
 * (agent-runtime container / Agent Sandbox Service) is the only thing that
 * knows how to turn this into an opencode.json / provider env vars. */
export function openshellModelFor(listing: Listing): OpenShellModelConfig | undefined {
  const provider = providerFor(listing);
  if (!provider) return undefined;
  return {
    kind: provider.kind,
    defaultModel: provider.defaultModel,
    baseUrl: provider.baseUrl,
    apiKey: apiKeyFor(provider.id),
  };
}

/** Resolves the listing's enabled MCP servers down to the subset a
 * cluster-hosted agent can actually reach directly: remote transports only
 * (streamable-http/sse) with a URL. stdio servers spawn a process on the
 * console host and are not reachable from a cluster-hosted deploy, so
 * they're silently dropped here rather than forwarded. Shared by
 * deployments.ts (generic-chat) and openshellDeploy.ts (OpenShell). */
export function mcpServersFor(listing: Listing): OpenShellMcpServerConfig[] {
  const bindings = listing.agentConfig?.mcpToolBindings;
  const serverIds = bindings && bindings.length > 0
    ? [...new Set(bindings.map((b) => b.serverId))]
    : listMcpServers()
        .filter((s) => s.enabled && s.connectionState === "connected")
        .map((s) => s.id);

  const out: OpenShellMcpServerConfig[] = [];
  for (const id of serverIds) {
    const server = getMcpServer(id);
    if (!server || !server.enabled) continue;
    if (server.transport !== "streamable-http" && server.transport !== "sse") continue;
    if (!server.url) continue;
    out.push({
      id: server.id,
      name: server.name,
      url: server.url,
      transport: server.transport,
      authToken: getMcpAuthToken(server.id),
    });
  }
  return out;
}
