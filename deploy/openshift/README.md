# OpenShift (eval)

Prototype only. OpenShell on OpenShift is experimental and currently wants the `privileged` SCC with TLS disabled. Private network, not production.

## P0 — OpenShell Gateway

Prerequisites: `oc`, Helm 3, Agent Sandbox controller/CRDs as documented by NVIDIA.

```bash
oc create ns openshell
oc adm policy add-scc-to-user privileged -z openshell-sandbox -n openshell

helm install openshell oci://ghcr.io/nvidia/openshell/helm-chart \
  --namespace openshell \
  --values deploy/openshift/openshell-values.yaml

oc -n openshell rollout status statefulset/openshell
oc -n openshell port-forward svc/openshell 8080:8080
```

Register the CLI against the forwarded gateway, then prove a sandbox:

```bash
openshell gateway add http://127.0.0.1:8080 --local --name openshift
openshell status
openshell sandbox create -- claude
```

If that fails, stop. Do not pretend Path A is live.

## Storefront

The Admin console's Providers/MCP/Secrets tabs persist to a local encrypted
vault under `SECRETS_DATA_DIR` (`apps/web/src/server/secrets.ts`) — it needs
a real volume and a stable encryption key to survive pod restarts, so create
those before the Deployment:

```bash
oc create secret generic agent-store-secrets \
  --from-literal=secrets-encryption-key="$(openssl rand -hex 32)"
oc apply -f deploy/openshift/pvc.yaml
```

Then build and push `apps/web`, and apply:

- `deploy/openshift/deployment.yaml`
- `deploy/openshift/service.yaml`
- `deploy/openshift/route.yaml`

Set `OPENSHELL_GATEWAY_URL` on the Deployment to the in-cluster gateway Service (plaintext eval: `http://openshell.openshell.svc.cluster.local:8080`) and ensure the `openshell` CLI is in the app image if you want live Path A.

Without that env var, Engineering listings stay on the simulated engine. Path B never needs OpenShell.

Do not scale `agent-store` beyond `replicas: 1` — the vault is a single-writer
file store on the PVC, not a shared/HA store (see `docs/DEFERRED.md`).
