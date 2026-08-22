# Deferred from the full Agent Store plan

This prototype is a product facade plus one real engine path. Do not treat FakeEngine, in-memory tasks, or privileged SCC as the architecture.

Deferred on purpose:

- Engine 2 (hosted / managed-agent APIs) and Engine 3
- Real connectors (Jira, ServiceNow, Slack, data warehouses) as built-in, AgentStore-shipped integrations — an admin can still point the MCP tab at their own MCP server for one of these, but AgentStore does not ship one
- Corporate SSO / OIDC (hardcoded `demo-user`)
- Temporal, NestJS + Go split, Kubebuilder Operator, CRDs
- Postgres catalog sync, GitOps / Argo CD
- A production KMS/Vault-backed secret store — the Admin **Secrets** tab (and the API keys/tokens stored by **Providers** and **MCP**) use a local AES-256-GCM encrypted file instead (see `apps/web/src/server/secrets.ts`), which is adequate for a demo but is not a substitute for a real secrets manager
- Kafka / SIEM audit pipeline and real cost metering
- Publisher self-service listing review
- Autonomous schedules (the CVE listing is one-shot in the prototype)
- OpenShift Console plugin
- Custom / restricted SCC (eval install uses `privileged` + TLS disabled)

What this repo is meant to keep:

- Storefront as the only user-facing surface
- Listing + Task as the nouns; engines behind `EngineAdapter`
- Both **Autonomous** and **Collaborative** modes, including an approval hold
- Department-browsable catalog
- A real Interactive path through OpenShell when `OPENSHELL_GATEWAY_URL` is set

What's real (as of the Admin Providers/MCP/Secrets work), beyond the facade:

- The Admin **Providers** tab makes real network calls to the configured model vendor (Anthropic, OpenAI, an OpenAI-compatible endpoint, or Gemini) to list models and to generate Autonomous-mode drafts, when a provider is configured and marked active. With no provider configured, drafting falls back to the original simulated per-listing text.
- The Admin **MCP** tab is a real MCP client (`@modelcontextprotocol/sdk`): it performs a real MCP handshake, lists a server's actual tools, and can call them from the drafting flow. `stdio` servers spawn a local process chosen by whoever has Admin access — treat Admin access accordingly.
- The Admin **Secrets** tab is a real encrypted local vault, not an in-memory-only mock like the catalog overrides and force-simulated engine toggle.
