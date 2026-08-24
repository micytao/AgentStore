# AAP Project for AgentStore

This directory is the **Ansible Automation Platform project**, not something
AgentStore executes itself. Import it as an AAP Project, create a Job Template
named e.g. `AgentStore - provision agent`, and point AgentStore's Platform tab
at that template.

## Job Template extra vars

AgentStore launches the template with:

| extra var | meaning |
| --- | --- |
| `listing_id` / `listing_name` | Catalog listing |
| `task_id` | AgentStore task id |
| `goal` / `success_criteria` | Requester goal |
| `namespace` | OpenShift namespace (`agent-workloads`) |
| `job_name` | Kubernetes Job name (`agent-<short-id>`) |
| `mode` | `do-this-for-me` or `work-with-me` |

Optional extra vars / credentials on the template:

- `agent_runner_image` — image built from `agent-runner/`
- `maas_base_url` / `maas_model` — OpenAI-compatible endpoint the Job calls
- Kubernetes credential for the prod OpenShift cluster

## Build the runner image

```bash
podman build -t agent-runner:dev -f ansible/agent-runner/Containerfile ansible/agent-runner
# push to the cluster registry, then set agent_runner_image on the template
```
