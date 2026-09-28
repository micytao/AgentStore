# AAP Project for AgentStore

This directory is the **Ansible Automation Platform project**, not something
AgentStore executes itself. It needs to be imported as an AAP Project with
two Job Templates pointing at it:

| Job Template | Playbook | Purpose |
| --- | --- | --- |
| e.g. `AgentStore - provision generic agent` | [provision-generic-agent.yml](provision-generic-agent.yml) | **Autonomous** agents (`runtime: "generic-chat"`) — a persistent Deployment + Route, deployed once per listing from Admin → Catalog → "Deploy to OpenShift" |
| e.g. `AgentStore - provision openshell gateway` | [provision-openshell-gateway.yml](provision-openshell-gateway.yml) | **Collaborative** agents' shared prerequisite — installs NVIDIA's OpenShell gateway Helm chart once per cluster from Admin → LLMs → OpenShell → "Install gateway" |

Both point at objects created in the same AAP Project/Inventory/Kubernetes
credential; the gateway install is unrelated to the Skills Agent runtime
([apps/agent-runtime](../apps/agent-runtime)) the first template deploys —
it's a one-time cluster prerequisite the (separately deployed) Agent
Sandbox Service talks to once running. Per-listing collaborative sessions
themselves are **not** launched via AAP — they go straight from AgentStore
to the Agent Sandbox Service's REST API (see
`apps/web/src/server/openshellDeploy.ts`).

## Recommended: create both Job Templates from AgentStore

Instead of clicking through the steps below by hand, go to **Admin →
Platform → AAP Job Templates** and click **"Create job templates"**. That
action (`apps/web/src/server/aapBootstrap.ts`, backed by
`packages/engine-ansible/src/jobTemplateBootstrap.ts`) calls the AAP REST
API directly to:

1. Look up the AAP Organization you name (default `Default` — must already
   exist; this step never creates one).
2. Find-or-create an AAP **Project** pointing at the Git URL/branch you
   give it (this repo, or your fork — must contain this `ansible/`
   directory at its root) and trigger its SCM sync.
3. Find-or-create an **Inventory** with a single `localhost` host
   (`ansible_connection: local`) — both playbooks run `hosts: localhost`
   against the AAP execution node itself, talking to the OpenShift API
   over HTTPS, not SSH to a remote host.
4. Find-or-create a **Kubernetes/OpenShift Bearer Token credential**,
   reusing the OpenShift API URL/token you already set in Admin → Platform
   → OpenShift — no separate secret to manage. This is what makes both
   playbooks' bare `kubernetes.core.k8s` tasks (no explicit `host`/
   `api_key` params) authenticate: AAP injects `K8S_AUTH_HOST`/
   `K8S_AUTH_API_KEY`/`K8S_AUTH_VERIFY_SSL` env vars from whatever
   credential is attached to the Job Template.
5. Find-or-create both **Job Templates** above, with
   `ask_variables_on_launch: true`, and attach the Kubernetes credential
   to each.
6. Save the resulting IDs onto `aapJobTemplateId` and
   `openshellGatewayJobTemplateId` — the exact same fields the manual path
   below has you paste in by hand, so every other admin action (Deploy to
   OpenShift, Install gateway, a listing's `agentConfig.aapJobTemplateId`
   override) works unchanged.

Every step is a find-or-create keyed by name, so re-running the action
after changing the Git branch or Execution Environment is always safe.

**The one thing this can't do through the AAP API**: *building* the
Execution Environment image itself — AAP has no endpoint for that, only
for registering an image that already exists in a registry. Two ways to
get one, both documented in [execution-environment/](execution-environment/):
build it inside your OpenShift cluster, triggered from the same "AAP Job
Templates" card via **"+ Build from source"** (no local tooling needed —
recommended if AAP can reach that cluster's registry); or build/push it
locally with `ansible-builder`, then use **"Register a new image"** next
to the Execution environment dropdown (that step *is* just an API call).

## Manual fallback: create everything by hand in the AAP web UI

If you'd rather not grant AgentStore's AAP token project/credential/job
template create permissions, you can still do every step above yourself:

1. **Project**: SCM type Git, pointing at this repo (or your fork),
   containing this `ansible/` directory.
2. **Inventory**: any inventory with at least one host is fine — the
   playbooks only ever target `localhost`.
3. **Credential**: type "OpenShift or Kubernetes API Bearer Token", host =
   your OpenShift API server URL, token = a token with permission to
   create Deployments/Services/Routes/Secrets/ConfigMaps (generic agent)
   and to `helm install` (gateway) in their respective namespaces.
4. **Job Templates**: one per playbook above, with that Project,
   Inventory, and Credential, and **"Prompt on Launch" → Variables**
   enabled (AgentStore always launches with `extra_vars`, which differ per
   call).
5. Paste the resulting template IDs into Admin → Platform → "Default job
   template id" (autonomous) and Admin → LLMs → OpenShell → "Gateway job
   template id" (collaborative).

## `provision-generic-agent.yml` extra vars

AgentStore launches this template with (see
`packages/engine-ansible/src/genericAgentDeploy.ts`'s
`launchGenericAgentDeploy()`, called from Admin → Catalog → "Deploy to
OpenShift"):

| extra var | meaning |
| --- | --- |
| `deployment_name` | Stable per-listing resource name (`agent-<short-id>`) |
| `namespace` | OpenShift namespace (`agent-workloads`) |
| `listing_id` / `listing_name` | Catalog listing |
| `agent_runtime_image` | Defaults to `agent-runtime:dev` |
| `provider_kind` / `provider_base_url` / `provider_default_model` / `provider_api_key` | The listing's bound (or global active) model provider |
| `intro_lines` / `skills` / `mcp_servers` | Persona framing + the listing's bound Skills/MCP servers — mounted as `config.json` |

Requires a Kubernetes/OpenShift Bearer Token credential attached to the
Job Template (see above) — without one, its `kubernetes.core.k8s` tasks
have no cluster to talk to.

## `provision-openshell-gateway.yml` extra vars

AgentStore launches this template with (see
`packages/engine-ansible/src/gatewayDeploy.ts`'s `launchGatewayDeploy()`,
called from Admin → LLMs → OpenShell → "Install gateway"):

| extra var | meaning |
| --- | --- |
| `release_name` | Helm release name; always `openshell` today |
| `namespace` | Admin-supplied, defaults to `openshell` — separate from `agent-workloads`, since the gateway is its own thing |
| `chart_ref` | Admin-supplied, defaults to the real published chart: `oci://ghcr.io/nvidia/openshell/helm-chart` |
| `chart_version` | Admin-supplied, optional — empty means "whatever `helm` resolves as latest" |
| `workload_kind` | `statefulset` (default, SQLite) or `deployment` (external Postgres, HA) — see docs.nvidia.com/openshell/kubernetes/openshift |

Requires the AAP execution environment to have the `kubernetes.core`
Ansible collection **and** the `helm` CLI available — not guaranteed on the
default EE; build/select an EE that has both (see above).

This job deliberately does **not** install the cluster-scoped Agent Sandbox
controller/CRDs the chart depends on — that's a separate, one-time,
elevated-privilege prerequisite. See
[deploy/openshift/README.md](../deploy/openshift/README.md).

## Build the agent-runtime image

```bash
podman build -t agent-runtime:dev -f apps/agent-runtime/Containerfile .
# push to the cluster registry, then set agent_runtime_image on the
# provision-generic-agent.yml Job Template's extra_vars
```
