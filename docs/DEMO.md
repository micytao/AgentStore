# Agent Store — demo walkthrough

Leadership script. AgentStore is the console; AAP provisions; OpenShift runs
the Job. You can walk this on a laptop (simulated AAP) or against a real
controller and cluster.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. No login; tasks are attributed to `Demo`.
Click **Demo** in the sidebar to become **Admin**.

## 1. Browse as a business user

Catalog is department-first: Support, Finance & HR, Data, Security, then
Engineering — though today only Support and Engineering have published
listings (`GET /api/listings`).

## 2. Launch a business agent (A — Autonomous / Skills Agent)

Autonomous always means the same engine underneath — a minimalist
`agent-core` + Skills agent, provisioned via AAP → OpenShift → MaaS/OpenShift
AI. The bundled catalog's Autonomous listings are all real Red Hat Agentic
Skill Packs, deployed once as a persistent chat:

1. Engineering → **Red Hat SRE Engineer** (or **Red Hat Customer Support**,
   **Red Hat OpenShift Virtualization**) → Admin deploys the listing once
   (AAP provisions a persistent OpenShift Deployment + Route).
2. Anyone opens the listing's link and chats with it directly, turn after
   turn — no per-launch approval step, but the same Skills engine, with its
   real bound Skills and MCP tool bindings.

Disconnected laptop: the deploy timeline is labeled **Simulated AAP**.
Connected AAP: the same UI shows the real job id and deep-links, and the
Deployment runs `apps/agent-runtime` with the listing's real bound Skills
and provider — not a canned MaaS call.

The Skills engine also supports a one-shot **launch → draft → Approve/Reject**
shape (`RUN_MODE=once`) for listings that don't set `runtime: generic-chat` —
see [README.md](../README.md#a--autonomous-mode-skills-agent-business-listings) —
but no example of that shape ships in the catalog today.

## 3. Show the Red Hat products

With Platform connected:

1. Open the AAP job from the task page (or Admin → Platform → recent jobs).
2. Open the OpenShift console Job in `agent-workloads`.
3. Same object, three UIs: AgentStore, AAP, OpenShift.

## 4. Admin → Platform

1. Switch to Admin.
2. **Secrets** — save `AAP_TOKEN` and `OPENSHIFT_TOKEN`.
3. **Platform** — controller URL, default job template, OpenShift API,
   namespace `agent-workloads`, console URLs. Save & test.
4. Bind a listing to a template under Catalog → Agent config, or use the default.

## 5. Optional: real MaaS drafts

**Admin → Providers → OpenShift AI — Model as a Service**. Test connection
(no API key). Activate. Autonomous drafts call that endpoint instead of
canned text.

## 6. Optional: Engineering / OpenShell

Catalog → Engineering → **OpenCode**. Collaborative session. Requires the
Agent Sandbox Service (`apps/agent-sandbox-service`, deployed in-cluster
next to the OpenShell gateway) for a live, actually-typeable sandbox;
otherwise simulated. Set its Route URL in Admin → LLMs → OpenShell and its
token in Admin → Secrets. See
[apps/agent-sandbox-service/README.md](../apps/agent-sandbox-service/README.md)
for the deployment steps and
[deploy/openshift/README.md](../deploy/openshift/README.md#5-optional-engineering-the-openshell-gateway--agent-sandbox-service)
for the manifests — including the new **Admin → LLMs → OpenShell → "Install
gateway"** self-service step for the OpenShell gateway itself, which used
to require a manual `helm install`.

## 7. Onboard a new hosted-agent-api agent

Admin → Catalog → **+ Onboard new agent**. Engine type **Hosted agent API
(AAP → OpenShift)**. Publish. Switch back to Demo; the listing is in the
catalog. Launch it — it follows the same AAP path.

## 8. Optional: Red Hat Developer Hub (self-service portal)

RHDH adds end-user self-service on top of AgentStore. Instead of asking an
admin to onboard every agent, a team lead opens RHDH's **Self-service**
page and fills in a wizard.

**Prerequisite:** RHDH 1.10+ running on the same OpenShift cluster.  See
[rhdh/README.md](../rhdh/README.md) for installation.

1. Open the RHDH portal (its Route URL).
2. Click **Self-service** in the sidebar.
3. Two AgentStore templates are listed:
   - **Request a New AI Agent** — creates a draft listing in AgentStore.
   - **Deploy an Existing Agent** — triggers the AAP deploy for a published listing.
4. Fill in the "Request" wizard: name, department, description, risk tier.
   Click **Create**.
5. Back in AgentStore (Admin → Catalog), the new draft listing appears.
   Admin reviews, binds provider/tools/skills, publishes, and deploys.
6. Once deployed, the agent appears in RHDH's **Software Catalog** as a
   discoverable Component (type `ai-agent`).

**Dynamic catalog sync:** AgentStore exposes `GET /api/rhdh/catalog-sync`
which returns catalog-info YAML for every published agent.  Uncomment the
matching `catalog.locations` entry in `rhdh/app-config-snippet.yaml` to
have RHDH auto-discover agents without static YAML files.

**Five Red Hat products, one story:**
Red Hat Developer Hub (self-service) → AgentStore (admin control plane) →
Ansible Automation Platform (provisioning) → OpenShift (runtime) →
OpenShift AI / MaaS (model serving).

## 9. Durability

Restart `npm run dev`. Tasks, catalog overrides, custom listings, providers,
MCP, skills, secrets, and Platform settings (`.data/platform.json`) survive.
