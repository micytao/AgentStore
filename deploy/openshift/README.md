# OpenShift artifacts for AgentStore

AgentStore itself is a **laptop/VM console**. It does not need to run on
OpenShift. What *does* run on OpenShift is the agent Deployment that
AgentStore creates directly via the K8s API when a user deploys a business
listing.

## 1. Workload namespace (required for the live demo)

```bash
oc apply -f deploy/openshift/agent-workloads.yaml
```

That creates `agent-workloads`, a ServiceAccount the console can use, and a
Role with permissions to create/read/delete Deployments and Services.

Mint a token for the console:

```bash
oc create token agentstore-console -n agent-workloads --duration=24h
```

Paste it into **Admin → Secrets → OpenShift API token**. Set the API and
console URLs on **Admin → Platform**.

## 2. Agent runtime image

The same `agent-runtime` image is used for every Skills Agent listing
(persistent chat Deployment):

```bash
podman build -t agent-runtime:dev -f apps/agent-runtime/Containerfile .
# push somewhere the cluster can pull
```

## 3. Deploy AgentStore to OpenShift (optional)

AgentStore can run off-cluster (laptop/VM) or be deployed to the same
OpenShift cluster as the agent workloads. Two options:

### Self-service (recommended)

Admin → Platform → **AgentStore on OpenShift** → **Deploy**. This builds
`apps/web/Containerfile` as an OpenShift BuildConfig and then applies
`deploy/openshift/agentstore.yaml` (Namespace `agentstore` + PVC +
Deployment + Service + Route). The Route URL appears once the pod is ready.

### Manual

```bash
# Build and push the image, then apply the manifests:
oc apply -f deploy/openshift/agentstore.yaml
# Set the Deployment's image to your pushed image:
oc set image deployment/agentstore agentstore=<your-registry>/agentstore:latest -n agentstore
```

Running on-cluster enables RHDH to proxy to AgentStore via the in-cluster
Service URL (`http://agentstore.agentstore.svc:3000/api`), avoiding
external Route exposure for the RHDH-to-AgentStore path.

## 4. Optional Engineering: the OpenShell gateway + Agent Sandbox Service

Two separate things run in-cluster for Engineering (OpenShell-mode)
listings, in this order:

1. **The OpenShell gateway itself** — NVIDIA's real sandboxing runtime (see
   [docs.nvidia.com/openshell/kubernetes/openshift](https://docs.nvidia.com/openshell/kubernetes/openshift)).
2. **The Agent Sandbox Service** (this repo's own microservice) — the
   in-cluster service that owns all `openshell` CLI / `node-pty` mechanics
   so the console never does. It talks to (1).

### 4a. One-time, per-cluster prerequisite: the Agent Sandbox controller

The OpenShell chart depends on Kubernetes SIG's Agent Sandbox
controller/CRDs being installed first. This is a **cluster-scoped,
elevated-privilege, one-time** bootstrap — treat it like installing
OpenShift itself, not part of AgentStore's self-service flow:

```bash
oc apply -f https://github.com/kubernetes-sigs/agent-sandbox/releases/latest/download/sandbox.yaml
```

A platform admin runs this once per cluster before anyone uses
**Admin → LLMs → OpenShell → "Install gateway"**.

**Admin → LLMs → OpenShell** also shows a live "Agent Sandbox controller:
installed/missing" check and a self-service **"Install Agent Sandbox
controller"** button that applies a pinned copy of the same manifest
([deploy/openshift/agent-sandbox-crds.yaml](agent-sandbox-crds.yaml))
directly via the OpenShift API, reusing the already-configured
`OPENSHIFT_TOKEN` — no separate credential. Try that
first; it only works if that token already carries cluster-admin-equivalent
RBAC (creating a CRD, ClusterRole and ClusterRoleBinding needs it), and
fails with a clear error pointing back at the manual `oc apply` command
above if it doesn't.

### 4b. Install the OpenShell gateway

**Admin → LLMs → OpenShell → Onboard the OpenShell gateway** runs
`helm upgrade --install` directly via the OpenShift API against an
admin-supplied chart reference (defaults to the real published chart,
`oci://ghcr.io/nvidia/openshell/helm-chart`), namespace, and workload kind
(StatefulSet/SQLite by default, or Deployment/Postgres for HA).

The OpenShift token used for this operation only needs Helm-install-shaped
permissions scoped to the gateway's own namespace (namespace create,
Role/RoleBinding/ServiceAccount/Secret/Service) — not cluster-admin, since
the controller/CRD bootstrap above is separate.

`openshell-values.yaml` (still **eval-only** — privileged SCC, TLS off) is
passed as a values file; don't use it as a production baseline. Production
deployments should leave TLS enabled (the chart auto-generates an mTLS
bundle via Helm hooks) and use OIDC (see below) instead of the plaintext
quick-eval path.

### 4c. OIDC credential (production, non-interactive gateway auth)

The gateway's real production auth model is OIDC — issuer, audience, and
RBAC role claims, not a browser login. The non-interactive identity the
Agent Sandbox Service's `openshell` CLI needs (see 4d) is registered via
that same OIDC client, so configure a Secret holding:

| Field | Purpose |
| --- | --- |
| OIDC issuer | The gateway's configured `server.oidc.issuer` |
| OIDC audience | The gateway's configured `server.oidc.audience` (chart default `openshell-cli`) |
| Client ID | Service-identity client id |
| Client secret | Service-identity client secret |

**Open gap** (flagging rather than guessing): the docs don't fully spell
out whether a single non-interactive CLI command (something like
`openshell gateway add --oidc-client-id ... --oidc-client-secret ...`)
completes client-credentials auth headlessly, or whether every login path
assumes a human browser flow. Verify this against a real gateway before
wiring it into the Agent Sandbox Service's startup — see the two options
already noted in
[apps/agent-sandbox-service/README.md](../../apps/agent-sandbox-service/README.md).

### 4d. Apply the Agent Sandbox Service

Once the gateway is running, apply the Agent Sandbox Service — the
in-cluster service that owns all `openshell` CLI / `node-pty` mechanics so
the console never does:

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
