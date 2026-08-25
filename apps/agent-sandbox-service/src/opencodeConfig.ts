import type { OpenShellMcpServerConfig, OpenShellModelConfig } from "@agentstore/shared";

/**
 * Builds an opencode.json (https://opencode.ai/docs/config/), uploaded into
 * the sandbox via `sandbox create --upload`. Shape learned from kdn's
 * pkg/agent/opencode.go (see the plan's "reference implementation" section)
 * plus OpenCode's own published config docs — reimplemented here, not
 * copied.
 *
 * Schema-version risk (flagged in the plan's open risks): this targets
 * OpenCode's v1 flat-`mcp` config shape (`mcp.<name> = {type, url, ...}`),
 * which is what every current OpenCode doc/example uses. A v2 schema exists
 * that nests servers under `mcp.servers` instead — if the OpenShell base
 * sandbox image ships an opencode-ai version that only understands v2,
 * this needs a matching update.
 */

const NATIVE_PROVIDER_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

const NATIVE_DEFAULT_MODEL: Record<string, string> = {
  anthropic: "claude-sonnet-4",
  openai: "gpt-4o-mini",
};

export function isNativeProvider(kind: string): boolean {
  return kind === "anthropic" || kind === "openai";
}

/** Env var OpenCode expects a native provider's key under, so the caller
 * (sessions.ts) knows what to set when launching the sandbox. Non-native
 * providers carry their key inside the generated config instead (see
 * buildOpenCodeConfig's custom `provider` block), so this returns
 * undefined for them. */
export function nativeProviderEnvVar(kind: string): string | undefined {
  return NATIVE_PROVIDER_ENV[kind];
}

function assertClusterReachable(baseUrl: string): void {
  let hostname = "";
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`Provider baseUrl "${baseUrl}" is not a valid URL`);
  }
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    throw new Error(
      `Provider baseUrl "${baseUrl}" points at localhost, which is not reachable from inside the OpenShift cluster. ` +
        "Point it at a cluster-reachable Service DNS name or Route instead — this service does not rewrite localhost URLs " +
        "(unlike kdn's same-machine rewrite to host.openshell.internal, which does not hold for AgentStore's remote-cluster topology)."
    );
  }
}

export function buildOpenCodeConfig(
  model: OpenShellModelConfig | undefined,
  mcpServers: OpenShellMcpServerConfig[] | undefined
): Record<string, unknown> {
  const config: Record<string, unknown> = { $schema: "https://opencode.ai/config.json" };

  if (model) {
    if (isNativeProvider(model.kind)) {
      config.model = `${model.kind}/${model.defaultModel || NATIVE_DEFAULT_MODEL[model.kind]}`;
    } else {
      if (!model.baseUrl) {
        throw new Error(`Provider kind "${model.kind}" requires a baseUrl to run inside a sandbox`);
      }
      assertClusterReachable(model.baseUrl);
      const providerName = "agentstore";
      const modelName = model.defaultModel || "default";
      config.model = `${providerName}/${modelName}`;
      config.provider = {
        [providerName]: {
          npm: "@ai-sdk/openai-compatible",
          name: "AgentStore provider",
          options: { baseURL: model.baseUrl, ...(model.apiKey ? { apiKey: model.apiKey } : {}) },
          models: { [modelName]: { name: modelName } },
        },
      };
    }
  }

  if (mcpServers && mcpServers.length > 0) {
    const mcp: Record<string, unknown> = {};
    for (const server of mcpServers) {
      mcp[server.id] = {
        type: "remote",
        url: server.url,
        enabled: true,
        oauth: false,
        ...(server.authToken ? { headers: { Authorization: `Bearer ${server.authToken}` } } : {}),
      };
    }
    config.mcp = mcp;
  }

  return config;
}
