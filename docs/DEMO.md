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

1. Customer Support → **Draft a ticket reply** → Launch.
2. Goal: `Draft a reply to INC-1042 about a billing outage`.
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

Catalog → Engineering → **Claude Code**. Collaborative session. Requires
`OPENSHELL_GATEWAY_URL` for a live sandbox; otherwise simulated.

## 7. Onboard a new hosted-agent-api agent

Admin → Catalog → **+ Onboard new agent**. Engine type **Hosted agent API
(AAP → OpenShift)**. Publish. Switch back to Demo; the listing is in the
catalog. Launch it — it follows the same AAP path.

## 8. Durability

Restart `npm run dev`. Tasks, catalog overrides, custom listings, providers,
MCP, skills, secrets, and Platform settings (`.data/platform.json`) survive.
