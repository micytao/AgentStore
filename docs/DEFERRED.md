# Deferred from the full Agent Store plan

This prototype is a product facade plus one real engine path. Do not treat FakeEngine, in-memory tasks, or privileged SCC as the architecture.

Deferred on purpose:

- Engine 2 (hosted / managed-agent APIs) and Engine 3 — `hosted-agent-api` listings still use `FakeEngine`
- Real connectors (Jira, ServiceNow, Slack, data warehouses) as built-in, AgentStore-shipped integrations — an admin can still point the MCP tab at their own MCP server for one of these, but AgentStore does not ship one
- Corporate SSO / OIDC as an actual login UI/identity system (hardcoded `Demo` as the task-requester identity). The sidebar's Demo/Admin switch (see "What's real" below) is a one-click role toggle for demo purposes, not an access-control mechanism — anyone with the URL can become "Admin." Real SSO would add per-user accounts, audit attribution beyond `Demo`, an actual login gate, and OIDC/OAuth against an IdP (e.g. OpenShift's built-in OAuth) — picked up if/when actual multi-user access control is needed.
- Temporal, NestJS + Go split, Kubebuilder Operator, CRDs
- Postgres catalog/task sync, GitOps / Argo CD — this phase moved tasks and catalog overrides from pure in-memory to file-backed JSON/YAML (see "What's real" below), which is real durability but still single-writer/single-replica, not a database
- A production KMS/Vault-backed secret store — the Admin **Secrets** tab (and the API keys/tokens stored by **Providers** and **MCP**) use a local AES-256-GCM encrypted file instead (see `apps/web/src/server/secrets.ts`), which is adequate for a demo but is not a substitute for a real secrets manager
- Kafka / SIEM audit pipeline and real cost metering
- Publisher self-service listing *review* — the onboarding wizard (see "What's real" below) gives a single admin a create → draft/publish toggle, not a multi-actor review pipeline with comments/rejection reasons/approval chains
- Booking / capacity / queueing for Collaborative mode — deliberately out of scope for this prototype; "book an agent and work with them" is satisfied by claim-and-launch a live session now, with no notion of an agent being "at capacity"
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

- The Admin **Providers** tab makes real network calls to the configured model vendor (Anthropic, OpenAI, an OpenAI-compatible endpoint, or Gemini) to list models and to generate Autonomous-mode drafts, when a provider is configured and marked active. With no provider configured, drafting falls back to the original simulated per-listing text. Self-hosted OpenAI-compatible servers (e.g. a local vLLM MaaS) work with **no API key** — see `docs/DEMO.md` step 5.
- The Admin **MCP** tab is a real MCP client (`@modelcontextprotocol/sdk`): it performs a real MCP handshake, lists a server's actual tools, and can call them from the drafting flow. `stdio` servers spawn a local process chosen by whoever has Admin access — treat Admin access accordingly.
- The Admin **Secrets** tab is a real encrypted local vault.

What's real (as of the gap-closure pass), beyond the above:

- **Server-tracked Admin role.** `apps/web/src/server/auth.ts` gates every `/api/admin/**` route behind a signed, `httpOnly` session cookie, set via `POST /api/session/elevate` when the sidebar Demo/Admin chip is clicked. There is deliberately no passcode or login — this makes the role a real server-side fact that `/api/admin/**` routes check (instead of a client-only `localStorage` flag anyone could flip from devtools), while staying a one-click demo convenience rather than actual access control. Real access control needs the SSO/OIDC work above.
- **Per-agent configuration.** Any listing can bind its own `AgentConfig` (model provider, an explicit MCP tool subset, one or more skills, an engine override) instead of every agent sharing one global provider/tool set. See `packages/shared/src/index.ts` (`AgentConfig`), `apps/web/src/server/drafting.ts`, `mcp.ts` (`listEnabledToolsFor`), and `engines.ts` (`isLiveEngine`).
- **Skills library.** `apps/web/src/server/skills.ts` is a real file-backed CRUD store; a skill's instructions are merged into an agent's system prompt at draft time when attached via its `AgentConfig`.
- **Agent onboarding + a real publish gate.** Admins create brand-new agents through a 5-step wizard (**Admin → Catalog → + Onboard new agent**); `catalog.ts` `createListing`/`deleteListing` write real YAML files into a writable `custom-listings` directory, separate from the shipped `catalog/listings`. `GET /api/listings`, `GET /api/listings/[id]`, and `POST /api/tasks` all filter/reject on `reviewStatus !== "published"` for non-admin callers — "onboard it, then it shows up for users" is now actually enforced server-side, not just a UI convention.
- **File-backed durability.** Task history (`.data/tasks.json`) and built-in-listing edits (`.data/catalog-overrides.json`) are now persisted the same way providers/MCP/secrets/skills already were, so an app restart no longer silently erases them. Custom agents created via the wizard are durable by construction (real YAML files). Still no database — still single-writer/single-replica.
