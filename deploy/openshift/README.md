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

## 4. The console itself

AgentStore runs off-cluster (laptop/VM/container elsewhere) and talks to AAP
and OpenShift over their APIs. There are no console Deployment/Route/PVC
manifests here — host the console however you host any other internal web
app.

## 5. Optional Engineering: the Agent Sandbox Service

The OpenShell gateway (Helm values in `openshell-values.yaml`, still
**eval-only** — privileged SCC, TLS off) needs the Kubernetes Agent Sandbox
controller/CRDs installed first. On top of that, apply the Agent Sandbox
Service — the in-cluster service that owns all `openshell` CLI / `node-pty`
mechanics so the console never does:

```bash
podman build -t agent-sandbox-service:dev \
  -f apps/agent-sandbox-service/Containerfile .
# push somewhere the cluster can pull, then set the image on the Deployment below

kubectl create secret generic agent-sandbox-service-token -n agent-workloads \
  --from-literal=OPENSHELL_SERVICE_TOKEN=$(openssl rand -hex 32)

oc apply -f deploy/openshift/agent-sandbox-service.yaml
```

Set the Route's URL in **Admin → LLMs → OpenShell → Service URL**, and the
same `OPENSHELL_SERVICE_TOKEN` value into **Admin → Secrets**. See
[apps/agent-sandbox-service/README.md](../../apps/agent-sandbox-service/README.md)
for the CLI-identity bootstrap this service needs (non-interactive — no
human to click through a browser login) before `POST /sessions` works.
