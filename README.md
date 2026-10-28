# Agent Store

Internal catalog of governed AI agents. Browse by department, deploy once,
and let every team member use a shared, persistent agent — either an
always-on **Autonomous** chat (Skills Agent engine, `agent-core` + Skills,
via OpenShift → OpenShift AI) or an interactive **Collaborative**
coding sandbox (OpenShell). Mode always follows which engine a listing
declares (see `deriveAgentMode()` in `packages/shared`).

AgentStore is a **lightweight console**. It can run locally on a laptop or
be deployed to the same OpenShift cluster as the agents (Admin → Platform →
"Deploy AgentStore to OpenShift"). When an admin deploys an agent,
it is provisioned directly to OpenShift via the K8s API. Admins configure
OpenShift connectivity from the Platform tab.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No login required;
click the **Demo** chip in the sidebar to switch to **Admin**.

### Autonomous Mode (Skills Agent)

The `agent-core` + Skills engine (`apps/agent-runtime`) runs as a
persistent chat, built on real Red Hat Agentic Skill Packs
(`redhat-sre-engineer`, `redhat-customer-support`,
`redhat-openshift-virtualization`):

1. Admin → Catalog → deploy the listing once (provisions a persistent
   OpenShift Deployment + Route directly via the K8s API).
2. Anyone opens the listing's link and chats with it directly — no
   per-user launch, no approval step.

### Collaborative Mode (OpenShell sandbox)

1. Catalog → Engineering → **OpenCode** → Launch.
2. Wait until status is Running, then type in the terminal.

Requires the Agent Sandbox Service for a live sandbox; otherwise simulated.
See [apps/agent-sandbox-service/README.md](apps/agent-sandbox-service/README.md).

### Admin console

Click **Demo** in the sidebar to become **Admin** (demo convenience, not
real SSO — see `docs/DEFERRED.md`). Tabs:

- **Catalog** — edit listings, bind per-agent config, onboard new agents
- **Providers / MCP / Skills / Secrets** — model, tools, vault
- **Platform** — connect OpenShift, deploy AgentStore itself to the cluster, list deployments
- **Self-service Portal** — install the RHDH operator and provision a Developer Hub instance with AgentStore integration
- **Engine** — connection status for OpenShell / OpenShift

## Resource labeling

Every Kubernetes resource AgentStore creates carries a standard label set
for easy grouping and cleanup inside a shared namespace:

| Label | Value | Purpose |
| --- | --- | --- |
| `app` | `agentstore` | Quick CLI filter (`oc get all -l app=agentstore`) |
| `app.kubernetes.io/part-of` | `agentstore` | OpenShift Console topology grouping |
| `app.kubernetes.io/managed-by` | `agentstore` | Provenance |
| `app.kubernetes.io/component` | `console`, `agent-runtime`, `agent-sandbox-service`, `build`, `gateway`, `rhdh`, `infrastructure` | Sub-system role |
| `app.kubernetes.io/name` | *(resource-specific)* | Specific workload identity |

## Configuration

| Variable | Purpose |
| --- | --- |
| `OPENSHIFT_API_URL` / `OPENSHIFT_TOKEN` / `OPENSHIFT_NAMESPACE` | Watch/stop agent Deployments (or Admin → Platform / Secrets) |
| `OPENSHELL_SERVICE_URL` / `OPENSHELL_SERVICE_TOKEN` | Console → Agent Sandbox Service (or Admin → LLMs → OpenShell / Secrets) |
| `AGENTSTORE_SERVICE_TOKEN` | Shared secret for RHDH service-to-service auth (or Admin → Secrets) |
| `CATALOG_DIR` | Override built-in `catalog/listings` |
| `CUSTOM_CATALOG_DIR` | Wizard-created listings (default `.data/custom-listings`) |
| `SESSION_SECRET` | Signs the Demo/Admin cookie |
| `SECRETS_ENCRYPTION_KEY` | Vault key (auto-generated if unset) |
| `SECRETS_DATA_DIR` | Vault / providers / tasks / platform.json (default `.data`) |

## Layout

```
apps/
  web/                        Next.js console + BFF
  agent-runtime/              Persistent chat container (one image, configured per listing)
  agent-sandbox-service/      In-cluster service for OpenShell CLI / node-pty
packages/
  shared/                     Listing / Task / Platform types
  agent-core/                 Provider + MCP + tool-hop + skills chat loop
  engine-openshift/           OpenShift direct provisioner
  engine-openshell/           Thin REST client against agent-sandbox-service
catalog/
  listings/                   Built-in YAML agent catalog
  skills/                     Red Hat Agentic Skill Packs (imported via scripts/)
deploy/openshift/             Namespace/RBAC, agent-sandbox-service, OpenShell gateway, AgentStore deploy
rhdh/                         Red Hat Developer Hub integration (optional)
docs/                         DEMO walkthrough + DEFERRED design decisions
scripts/                      Dev-time tools (import-redhat-skills)
```

### Optional: Red Hat Developer Hub (self-service portal)

The `rhdh/` directory adds end-user self-service via
[Red Hat Developer Hub](https://developers.redhat.com/products/rhdh) —
team leads discover agents in the Software Catalog, request new ones
through a wizard, and trigger deploys without admin access to AgentStore.
AgentStore works without RHDH. See [rhdh/README.md](rhdh/README.md).

See [docs/DEMO.md](docs/DEMO.md) for the full walkthrough.
