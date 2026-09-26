# Agent Store (prototype)

Internal catalog of governed AI agents. Browse by department, launch a task,
and either work interactively in a live sandbox (Collaborative / C) or let
a minimalist Skills-equipped agent work on its own (Autonomous / A) — either
handing back a draft for you to approve, or as an always-on assistant you
message directly. The two labels are a strict 1:1 mapping onto which engine
actually runs the agent (see `deriveAgentMode()` in `packages/shared`):
Autonomous is always the Skills Agent engine (`agent-core` + Skills, via
AAP → OpenShift → MaaS/OpenShift AI); Collaborative is always the OpenShell
sandbox engine. Mode is never picked independently — it always follows
which engine a listing declares.

AgentStore is a **lightweight console**. It does not need to run on OpenShift.
When a user launches a business agent, **Ansible Automation Platform**
provisions it and the workload runs as an OpenShift Job. Admins connect both
clusters from the Platform tab.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). There is no per-user
login; every task is attributed to `Demo`. Click the **Demo** chip at the
bottom of the sidebar to switch to **Admin**.

### A — Autonomous Mode (Skills Agent, business listings)

Same underlying `agent-core` + Skills engine (`apps/agent-runtime`) supports
two delivery shapes. The bundled catalog currently ships only the
**persistent chat** shape, built on real Red Hat Agentic Skill Packs
(`redhat-sre-engineer`, `redhat-customer-support`,
`redhat-openshift-virtualization`):

1. Admin → Catalog → deploy the listing once (AAP provisions a persistent
   OpenShift Deployment + Route via `ansible/provision-generic-agent.yml`).
2. Anyone opens the listing's link and chats with it directly, turn after
   turn — no per-user launch, no approval step.

The engine also supports a **one-shot draft** shape — launch → AAP job →
OpenShift Job → draft → Approve/Reject, running
`apps/agent-runtime` in one-shot mode (`RUN_MODE=once`) via
`ansible/provision-agent.yml` — but no example listing ships in the catalog
today. Onboard a new `hosted-agent-api` listing without `runtime:
generic-chat` (Admin → Catalog → **+ Onboard new agent**) to use it.

Without AAP connected, either shape's timeline is a **labeled simulated
AAP job**. With Admin → Platform pointed at a real controller (and
`AAP_TOKEN` in Secrets), launch calls
`POST /api/v2/job_templates/{id}/launch/` against the real cluster.

### C — Collaborative Mode (OpenShell sandbox, Engineering)

1. Catalog → Engineering → **OpenCode** → Launch.
2. Wait until status is Running, then type in the terminal.
3. Stop session. The task appears under **My Tasks**.

Without the Agent Sandbox Service configured, this is a simulated session.
With `openshellServiceUrl` set (Admin → LLMs → OpenShell) and
`OPENSHELL_SERVICE_TOKEN` in Secrets, Engineering listings provision a real
sandbox via that in-cluster service and the terminal is a real WebSocket
connection straight to it — see
[apps/agent-sandbox-service](apps/agent-sandbox-service/README.md).

### Admin console

Click **Demo** in the sidebar to become **Admin** (demo convenience, not real
SSO — see `docs/DEFERRED.md`). Tabs:

- **Catalog** — edit listings, bind per-agent config, onboard new agents
- **Providers / MCP / Skills / Secrets** — model, tools, vault
- **Platform** — connect AAP and prod OpenShift, bind job templates, list jobs
- **Engine** — force simulated; connection status for OpenShell / AAP / OpenShift

## Configuration

| Variable | Purpose |
| --- | --- |
| `AAP_CONTROLLER_URL` / `AAP_TOKEN` / `AAP_JOB_TEMPLATE_ID` | Live AAP (or set in Admin → Platform / Secrets) |
| `OPENSHIFT_API_URL` / `OPENSHIFT_TOKEN` / `OPENSHIFT_NAMESPACE` | Watch/stop agent Jobs (or Admin → Platform / Secrets) |
| `OPENSHELL_SERVICE_URL` / `OPENSHELL_SERVICE_TOKEN` | Console → Agent Sandbox Service (or Admin → LLMs → OpenShell / Secrets) |
| `CATALOG_DIR` | Override built-in `catalog/listings` |
| `CUSTOM_CATALOG_DIR` | Wizard-created listings (default `.data/custom-listings`) |
| `SESSION_SECRET` | Signs the Demo/Admin cookie |
| `SECRETS_ENCRYPTION_KEY` | Vault key (auto-generated if unset) |
| `SECRETS_DATA_DIR` | Vault / providers / tasks / platform.json (default `.data`) |

## Layout

- `apps/web` — Next.js console + BFF
- `apps/agent-sandbox-service` — in-cluster service owning all OpenShell CLI / `node-pty` mechanics behind a REST + WebSocket API
- `packages/shared` — Listing / Task / Platform types and `EngineAdapter`
- `packages/engine-ansible` — AAP live provisioner + labeled simulated fallback
- `packages/engine-fake` — canned drafts
- `packages/engine-openshell` — thin REST client against `apps/agent-sandbox-service`
- `catalog/listings` — built-in YAML catalog
- `ansible/` — AAP Project (one-shot draft + persistent chat playbooks, both against `apps/agent-runtime`)
- `deploy/openshift` — `agent-workloads` namespace/RBAC, `agent-sandbox-service.yaml`, OpenShell gateway Helm values
- `docs/DEMO.md` / `docs/DEFERRED.md`

See [docs/DEMO.md](docs/DEMO.md) for the walkthrough.
