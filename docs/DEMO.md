# Agent Store — demo walkthrough

Leadership script. AgentStore is the console; agents deploy directly to
OpenShift via the K8s API. You can walk this on a laptop (simulated deploy)
or against a real cluster.

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
`agent-core` + Skills agent, deployed directly to OpenShift → OpenShift
AI. The bundled catalog's Autonomous listings are all real Red Hat Agentic
Skill Packs, deployed once as a persistent chat:

1. Engineering → **Red Hat SRE Engineer** (or **Red Hat Customer Support**,
   **Red Hat OpenShift Virtualization**) → Admin deploys the listing once
   (provisions a persistent OpenShift Deployment + Route via the K8s API).
2. Anyone opens the listing's link and chats with it directly, turn after
   turn — no per-launch approval step, but the same Skills engine, with its
   real bound Skills and MCP tool bindings.

Disconnected laptop: the deploy timeline is labeled **Simulated**.
Connected OpenShift: the same UI shows the real Deployment name and
deep-links, and the Deployment runs `apps/agent-runtime` with the listing's
real bound Skills and provider.

The Skills engine also supports a one-shot **launch → draft → Approve/Reject**
shape (`RUN_MODE=once`) for listings that don't set `runtime: generic-chat` —
see [README.md](../README.md#a--autonomous-mode-skills-agent-business-listings) —
but no example of that shape ships in the catalog today.

## 3. Show the Red Hat products

With Platform connected:

1. Open the OpenShift console Deployment in `agent-workloads`.
2. Same object, two UIs: AgentStore and OpenShift.

## 4. Admin → Platform

1. Switch to Admin.
2. **Secrets** — save `OPENSHIFT_TOKEN`.
3. **Platform** — OpenShift API URL, namespace `agent-workloads`, console
   URLs. Save & test.

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

## 7. Onboard a new agent

Admin → Catalog → **+ Onboard new agent**. Engine type **OpenShift
(direct deploy)**. Publish. Switch back to Demo; the listing is in the
catalog. Launch it — it follows the same direct OpenShift deploy path.

## 8. Deploy AgentStore to OpenShift

AgentStore can run on the same cluster as the agent workloads:

1. Admin → Platform → scroll to **AgentStore on OpenShift** card.
2. Click **Deploy**. This triggers an OpenShift Build (apps/web/Containerfile)
   and then applies the Namespace/Deployment/Service/Route/PVC manifests.
3. Wait for the progress bar to reach "Complete" — the Route URL appears.

The in-cluster AgentStore is now reachable at that Route, and RHDH can
proxy to it via `http://agentstore.agentstore.svc:3000/api` without
external networking.

## 9. Optional: Red Hat Developer Hub (self-service portal)

RHDH adds end-user self-service on top of AgentStore. The RHDH operator
and instance can now be installed entirely from within AgentStore:

1. Admin → **Self-service Portal** sidebar.
2. The preflight strip shows what's ready (OpenShift, AgentStore on
   cluster, RHDH operator, instance, service token).
3. Click **Install Operator** — creates the `rhdh` namespace, OperatorGroup,
   and Subscription from the `redhat-operators` CatalogSource. Poll until
   the CRD appears.
4. Fill in the instance form (RHDH namespace, AgentStore internal URL) and
   click **Deploy Instance** — creates ConfigMaps, Secret, and a Backstage
   CR. The operator rolls out the Developer Hub pod.
5. Once the Route URL appears, open it — the Software Templates are live.

**Manual install alternative:** See [rhdh/README.md](../rhdh/README.md) for
step-by-step `oc` commands instead of the self-service flow.

Once RHDH is running (via either method):

1. Open the RHDH portal (its Route URL).
2. Click **Self-service** in the sidebar.
3. Two AgentStore templates are listed:
   - **Request a New AI Agent** — creates a draft listing in AgentStore.
   - **Deploy an Existing Agent** — triggers the deploy for a published listing.
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
OpenShift (runtime) → OpenShift AI / MaaS (model serving) → all deployed
from one console.

## 10. Durability

Restart `npm run dev`. Tasks, catalog overrides, custom listings, providers,
MCP, skills, secrets, and Platform settings (`.data/platform.json`) survive.
