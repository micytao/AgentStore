# Red Hat Developer Hub integration

Optional self-service layer on top of AgentStore. End users discover
agents, request new ones, and trigger deploys from RHDH's Software
Templates without needing direct access to the AgentStore admin console.

## What it adds to the Red Hat story

| Product | Role |
| --- | --- |
| **Red Hat Developer Hub** | End-user self-service portal (discover agents, request new ones) |
| **AgentStore** | Admin control plane (onboard, configure, bind skills/tools/models) |
| **Ansible Automation Platform** | Provisioning pipeline (Job Templates, Execution Environments) |
| **OpenShift** | Agent runtime (Deployments, Routes, BuildConfigs) |
| **OpenShift AI / MaaS** | Model serving (inference endpoints for the agents) |

RHDH is an overlay, not a dependency.  AgentStore keeps working without it.

## Prerequisites

- RHDH 1.10+ running on the same OpenShift cluster (Operator or Helm).
- AgentStore reachable via a Route or Service URL from the RHDH namespace.
- A shared service token (`AGENTSTORE_SERVICE_TOKEN`) so the RHDH proxy
  can authenticate against AgentStore's API.

## Files in this directory

```
rhdh/
├── README.md                           ← you are here
├── app-config-snippet.yaml             ← RHDH app-config overlay
├── dynamic-plugins.yaml                ← enables the http:backstage:request action
├── catalog/
│   └── catalog-info.yaml               ← System + Component entities for built-in agents
└── templates/
    ├── request-agent/
    │   └── template.yaml               ← "Request a New AI Agent" wizard
    └── deploy-agent/
        └── template.yaml               ← "Deploy an Existing Agent" wizard
```

## Quick-start (Operator install)

### 1. Install the RHDH Operator

From the OpenShift console: **Operators → OperatorHub → search
"Red Hat Developer Hub" → Install**.  Accept the defaults (installs
cluster-wide, creates the `rhdh` namespace automatically).

### 2. Create the configuration ConfigMaps

Replace `CLUSTER_DOMAIN` in `app-config-snippet.yaml` and
`catalog-info.yaml` with your cluster's apps domain, then:

```bash
oc create configmap agentstore-rhdh-app-config \
  --from-file=app-config.yaml=rhdh/app-config-snippet.yaml \
  -n rhdh

oc create configmap agentstore-rhdh-dynamic-plugins \
  --from-file=dynamic-plugins.yaml=rhdh/dynamic-plugins.yaml \
  -n rhdh
```

### 3. Create the secrets

```bash
oc create secret generic rhdh-secrets -n rhdh \
  --from-literal=AGENTSTORE_URL=https://agentstore.apps.CLUSTER_DOMAIN/api \
  --from-literal=AGENTSTORE_SERVICE_TOKEN=<token>
```

### 4. Create the Backstage CR

```yaml
apiVersion: rhdh.redhat.com/v1alpha5
kind: Backstage
metadata:
  name: developer-hub
  namespace: rhdh
spec:
  application:
    appConfig:
      mountPath: /opt/app-root/src
      configMaps:
        - name: agentstore-rhdh-app-config
    dynamicPluginsConfigMapName: agentstore-rhdh-dynamic-plugins
    extraEnvs:
      secrets:
        - name: rhdh-secrets
    replicas: 1
    route:
      enabled: true
  database:
    enableLocalDb: true
```

```bash
oc apply -f - <<'EOF'
# (paste the YAML above)
EOF
```

### 5. Wait for the Route

```bash
oc get route -n rhdh
```

Open the Route URL.  The two Software Templates appear under
**Self-service** (sidebar).

## How it works

```
End user (RHDH)
    │
    ├─ "Request a New AI Agent" template
    │     └─ http:backstage:request  →  POST /proxy/agentstore/admin/listings
    │                                        (creates a draft listing)
    │
    └─ "Deploy an Existing Agent" template
          └─ http:backstage:request  →  POST /proxy/agentstore/admin/listings/{id}/deploy
                                             (triggers AAP job → OpenShift)
```

The RHDH proxy (`/agentstore`) forwards requests to the real AgentStore
API, injecting the `X-AgentStore-Token` header for service-to-service
authentication.  AgentStore remains the source of truth for agent
lifecycle; RHDH is purely a self-service front-end.

## Dynamic catalog sync (optional)

AgentStore exposes `GET /api/rhdh/catalog-sync` which returns
`catalog-info.yaml` YAML for every published and deployed agent.
Uncomment the matching `catalog.locations` entry in `app-config-snippet.yaml`
to have RHDH auto-discover agents without static catalog-info files.

## Customisation

- **Add more templates:** drop a new `template.yaml` under `rhdh/templates/`
  and add a `catalog.locations` entry in the app-config.
- **Replace guest auth:** swap the `auth.providers.guest` block for
  `oidc` / `rhsso` in production.
- **Restrict access:** use RHDH's built-in RBAC to limit which teams
  can see which templates (e.g. only SRE leads can deploy high-risk agents).
