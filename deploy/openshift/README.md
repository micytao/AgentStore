# OpenShift artifacts for AgentStore

AgentStore itself is a **laptop/VM console**. It does not need to run on
OpenShift. What *does* run on OpenShift is the production agent Job that AAP
creates when a user launches a business listing.

## 1. Workload namespace (required for the live demo)

```bash
oc apply -f deploy/openshift/agent-workloads.yaml
```

That creates `agent-workloads`, a ServiceAccount AAP can use as a Kubernetes
credential, and a read/delete Role the console uses via `OPENSHIFT_TOKEN`.

Mint a token for the console (optional — only if you want the task page to
watch the Job directly):

```bash
oc create token agentstore-console -n agent-workloads --duration=24h
```

Paste it into **Admin → Secrets → OpenShift API token**. Set the API and
console URLs on **Admin → Platform**.

## 2. AAP credential and job template

See [ansible/README.md](../../ansible/README.md). The Kubernetes credential
in AAP should use `aap-agent-provisioner` (or an equivalent token with Job
create in `agent-workloads`).

## 3. Agent runner image

```bash
podman build -t agent-runner:dev \
  -f ansible/agent-runner/Containerfile \
  ansible/agent-runner
# push somewhere the cluster can pull, then set agent_runner_image on the template
```

## 4. Optional: host the console on OpenShift

The storefront Deployment/Route/PVC in this directory is **optional**. Use it
only if you want the console on-cluster later. It is not required for the
AAP → OpenShift demo. Do not scale it past `replicas: 1` — the secrets vault
is a single-writer file on the PVC.

OpenShell Helm values remain **optional Engineering** (privileged SCC, TLS
off, eval only).
