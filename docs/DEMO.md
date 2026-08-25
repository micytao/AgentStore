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
Engineering. Only **published** listings show (`GET /api/listings`).

## 2. Launch a business agent (A)

1. Customer Support → **Ticket triage & routing** → Launch.
2. Goal: `Triage this week's open ticket queue and flag anything urgent`.
3. The task page shows an **AAP job** and an **OpenShift Job**
   (`agent-<id>` in `agent-workloads`).
4. Wait for **AwaitingApproval**, read the draft, Approve or Reject.

Disconnected laptop: the timeline is labeled **Simulated AAP**. Connected
AAP: the same UI shows the real job id and deep-links.

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

**Admin → Providers → Self-hosted / vLLM (MaaS)**. Test connection (no API
key). Activate. Autonomous drafts call that endpoint instead of canned text.

## 6. Optional: Engineering / OpenShell

Catalog → Engineering → **OpenCode**. Collaborative session. Requires the
Agent Sandbox Service (`apps/agent-sandbox-service`, deployed in-cluster
next to the OpenShell gateway) for a live, actually-typeable sandbox;
otherwise simulated. Set its Route URL in Admin → LLMs → OpenShell and its
token in Admin → Secrets. See
[apps/agent-sandbox-service/README.md](../apps/agent-sandbox-service/README.md)
for the deployment steps and [deploy/openshift/README.md](../deploy/openshift/README.md#5-optional-engineering--the-agent-sandbox-service)
for the manifests.

## 7. Onboard a new hosted-agent-api agent

Admin → Catalog → **+ Onboard new agent**. Engine type **Hosted agent API
(AAP → OpenShift)**. Publish. Switch back to Demo; the listing is in the
catalog. Launch it — it follows the same AAP path.

## 8. Durability

Restart `npm run dev`. Tasks, catalog overrides, custom listings, providers,
MCP, skills, secrets, and Platform settings (`.data/platform.json`) survive.
