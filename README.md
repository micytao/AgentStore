# Agent Store

Internal catalog of governed AI agents. Browse by department, deploy once,
and let every team member use a shared, persistent agent — either an
always-on **Autonomous** chat (Skills Agent engine, `agent-core` + Skills,
via AAP → OpenShift → MaaS/OpenShift AI) or an interactive **Collaborative**
coding sandbox (OpenShell). Mode always follows which engine a listing
declares (see `deriveAgentMode()` in `packages/shared`).

AgentStore is a **lightweight console**. It does not need to run on
OpenShift. When an admin deploys an agent, **Ansible Automation Platform**
provisions it and the workload runs on OpenShift. Admins connect both
clusters from the Platform tab.

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

1. Admin → Catalog → deploy the listing once (AAP provisions a persistent
   OpenShift Deployment + Route via `ansible/provision-generic-agent.yml`).
2. Anyone opens the listing's link and chats with it directly — no
   per-user launch, no approval step.

Without AAP connected the deploy timeline is a **labeled simulated AAP
job**. With Admin → Platform pointed at a real controller (and `AAP_TOKEN`
in Secrets), deploy calls the real AAP API.

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
- **Platform** — connect AAP and prod OpenShift, bind job templates, list jobs
- **Engine** — connection status for OpenShell / AAP / OpenShift

## Configuration

| Variable | Purpose |
| --- | --- |
| `AAP_CONTROLLER_URL` / `AAP_TOKEN` / `AAP_JOB_TEMPLATE_ID` | Live AAP (or set in Admin → Platform / Secrets) |
| `OPENSHIFT_API_URL` / `OPENSHIFT_TOKEN` / `OPENSHIFT_NAMESPACE` | Watch/stop agent Jobs (or Admin → Platform / Secrets) |
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
  engine-ansible/             AAP live provisioner + simulated fallback
  engine-openshell/           Thin REST client against agent-sandbox-service
catalog/
  listings/                   Built-in YAML agent catalog
  skills/                     Red Hat Agentic Skill Packs (imported via scripts/)
ansible/                      AAP playbooks + Execution Environment definition
deploy/openshift/             Namespace/RBAC, agent-sandbox-service, OpenShell gateway
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
