# Deferred from the full Agent Store plan

This prototype is a lightweight console plus two real engine paths (AAP →
OpenShift for business listings, optional OpenShell for Engineering). Do not
treat simulated AAP, file-backed JSON, or privileged SCC as the architecture.

Deferred on purpose:

- Replacing AAP or the OpenShift Console (no inventory editor, node admin, or full template designer)
- Running `ansible-playbook` inside the AgentStore process
- Requiring AgentStore to be deployed on OpenShift (optional manifests only)
- Engine 3 / a Kubebuilder Operator and Agent CRDs
- Real connectors (Jira, ServiceNow, Slack, warehouses) as built-in AgentStore integrations — admins can still point MCP at their own server
- Corporate SSO / OIDC as an actual login UI (hardcoded `Demo`). The Demo/Admin chip is a one-click role toggle, not access control
- Temporal, NestJS + Go split
- Postgres / GitOps / Argo CD — file-backed JSON/YAML only
- Production KMS/Vault — local AES-256-GCM vault in `apps/web/src/server/secrets.ts`
- Kafka / SIEM audit and real cost metering
- Multi-actor listing review
- Booking / capacity / queues for Collaborative mode
- Autonomous schedules
- OpenShift Console plugin
- Hardened SCC (eval OpenShell still wants privileged + TLS off)

What this repo is meant to keep:

- Console as the user-facing surface (not a cluster citizen)
- Listing + Task as the nouns; engines behind `EngineAdapter`
- Business listings provisioned by AAP, running as OpenShift Jobs
- Both Autonomous and Collaborative modes, including an approval hold
- Department-browsable catalog
- Optional Interactive path through OpenShell, via the in-cluster Agent
  Sandbox Service, when `openshellServiceUrl` + `OPENSHELL_SERVICE_TOKEN`
  are set

What's real, beyond the facade:

- **AAP provisioner.** `packages/engine-ansible` launches AAP job templates when Admin → Platform + `AAP_TOKEN` are set. Otherwise it runs a labeled simulated AAP job — FakeEngine is no longer the business path.
- **OpenShift watch.** The console can list/get/delete Jobs in `agent-workloads` with `OPENSHIFT_TOKEN`. AAP's playbook (`ansible/provision-agent.yml`) is what creates them.
- Admin **Platform** tab: connect/test AAP and prod OpenShift, bind job templates, deep-link to both consoles.
- Admin **Providers** tab: real vendor/MaaS calls for Autonomous drafts; canned fallback if unset.
- Admin **MCP** tab: real MCP client (`@modelcontextprotocol/sdk`).
- Admin **Secrets** tab: encrypted local vault (includes `AAP_TOKEN`, `OPENSHIFT_TOKEN`, `OPENSHELL_SERVICE_TOKEN`, `GIT_PAT`).
- Server-tracked Admin role, per-agent `AgentConfig` (including `aapJobTemplateId`), skills library, onboarding publish gate, file-backed durability including `.data/platform.json`.
- **Agent Sandbox Service** (`apps/agent-sandbox-service`). Real, in-cluster Node/TS service that generates a per-agent config file (`opencode.json`), registers OpenShell provider credentials, runs `sandbox create/get/delete` via the real `openshell` CLI, and relays a real interactive terminal to the browser over a signed-token WebSocket + `node-pty`. `packages/engine-openshell` is a thin REST client against it — no CLI, no `node-pty`, no custom HTTP server on the console itself.
