# AAP Project for AgentStore

This directory is the **Ansible Automation Platform project**, not something
AgentStore executes itself. Import it as an AAP Project and create three Job
Templates:

| Job Template | Playbook | Purpose |
| --- | --- | --- |
| e.g. `AgentStore - provision agent` | [provision-agent.yml](provision-agent.yml) | Skills Agent, one-shot draft (`RUN_MODE=once`) — a batch Job that runs one turn and exits |
| e.g. `AgentStore - provision generic agent` | [provision-generic-agent.yml](provision-generic-agent.yml) | Skills Agent, persistent chat (`RUN_MODE` unset) — a Deployment + Route the admin deploys once from Admin → Catalog |
| e.g. `AgentStore - provision openshell gateway` | [provision-openshell-gateway.yml](provision-openshell-gateway.yml) | Engineering, OpenShell gateway install (once per cluster) — `helm upgrade --install` from Admin → LLMs → OpenShell |

The first two both point at the same `agent-runtime` image
([apps/agent-runtime](../apps/agent-runtime)), the Skills Agent's one and
only engine, just in two run modes. The third is unrelated to the Skills
Agent — it installs NVIDIA's real OpenShell chart the (separately deployed)
Agent Sandbox Service talks to.

Point AgentStore's Platform tab (or a listing's `agentConfig.aapJobTemplateId`)
at whichever template matches that listing's shape.

## `provision-agent.yml` extra vars

AgentStore launches the template with (see
`packages/engine-ansible/src/index.ts`'s `extraVars()`):

| extra var | meaning |
| --- | --- |
| `listing_id` / `listing_name` | Catalog listing |
| `task_id` | AgentStore task id |
| `goal` / `success_criteria` | Requester goal |
| `namespace` | OpenShift namespace (`agent-workloads`) |
| `job_name` | Kubernetes Job name (`agent-<short-id>`) |
| `mode` | Always `do-this-for-me` — the Skills Agent's one-shot shape (see `deriveAgentMode()`) |
| `agent_runtime_image` | Defaults to `agent-runtime:dev` — same image as the persistent-chat shape |
| `provider_kind` / `provider_base_url` / `provider_default_model` / `provider_api_key` | The listing's bound (or global active) model provider |
| `intro_lines` / `skills` | Persona framing + the listing's bound Skills (full objects, with instructions) — mounted as `config.json`, same convention as `provision-generic-agent.yml` |

Optional extra vars / credentials on the template:

- Kubernetes credential for the prod OpenShift cluster

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
default EE; build/select an EE that has both.

This job deliberately does **not** install the cluster-scoped Agent Sandbox
controller/CRDs the chart depends on — that's a separate, one-time,
elevated-privilege prerequisite. See
[deploy/openshift/README.md](../deploy/openshift/README.md).

## Build the agent-runtime image

```bash
podman build -t agent-runtime:dev -f apps/agent-runtime/Containerfile .
# push to the cluster registry, then set agent_runtime_image on both Skills Agent templates
```
