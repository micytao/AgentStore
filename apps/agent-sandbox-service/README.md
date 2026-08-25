# Agent Sandbox Service

Owns every OpenShell/`node-pty` mechanic behind a small REST + WebSocket
API, so the AgentStore console (`packages/engine-openshell`) never runs the
`openshell` CLI, `node-pty`, or a custom HTTP server itself. Deployed once,
in-cluster, next to the OpenShell gateway (see the plan's Stage B1/B2/B3).

This mirrors `packages/engine-ansible`'s relationship to AAP: AgentStore
never runs `ansible-playbook`; it calls AAP's REST API and AAP does the
heavy lifting. This service is the OpenShell-side equivalent of AAP.

## API

All `/sessions*` routes require `Authorization: Bearer $OPENSHELL_SERVICE_TOKEN`.

- `GET /health` — unauthenticated liveness check (used by Admin → Platform).
- `POST /sessions` — `{ taskId, agent, model?, mcpServers?, gitUrl?, gitToken? }` → `{ id, phase }`. Builds the agent-specific config (`opencode.json` for `agent: "opencode"`), registers/reuses an OpenShell provider for native model credentials, runs `sandbox create --detach --output json --upload ...`, optionally clones a repo.
- `GET /sessions/:id` — `{ id, phase, message? }`, wraps `sandbox get --output json`.
- `DELETE /sessions/:id` — kills any attached pty, then `sandbox delete`.
- `POST /sessions/:id/terminal-token` — `{ url }`, a `wss://` URL with a short-lived signed token embedded.
- `WS /sessions/:id/terminal?token=...` — verifies the token, spawns (or reattaches to) `openshell sandbox connect <id>` under `node-pty`, relays bytes both ways. Send `{"type":"resize","cols":N,"rows":N}` as a text frame to resize.

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port (default `8090`) |
| `OPENSHELL_SERVICE_TOKEN` | Bearer token the console must present. **Required** — every `/sessions*` request is rejected if unset. |
| `TERMINAL_TOKEN_SECRET` | HMAC key for terminal tokens (falls back to `OPENSHELL_SERVICE_TOKEN`) |
| `TERMINAL_TOKEN_TTL_MS` | Terminal token lifetime (default 5 min) |
| `TERMINAL_IDLE_TIMEOUT_MS` | Kill an unattached pty after this long (default 30 min) |
| `TERMINAL_PUBLIC_PROTOCOL` | `wss` (default) or `ws` for a local plaintext test |
| `OPENSHELL_CREATE_ARGS` | Extra space-separated args appended to every `sandbox create` |

The `openshell` CLI itself needs its own identity registered inside this
pod — non-interactively, since there's no human to click through a browser
login (Stage B1). Two options, both outside this repo's code:

1. A mounted Secret containing a pre-authenticated `~/.config/openshell/`
   directory (simplest; rotate by re-provisioning the Secret).
2. An init container/step running `openshell gateway add --oidc-client-id
   ... --oidc-client-secret ...` (or whatever your gateway's non-interactive
   auth mode is) before the main process starts.

## Local build

```bash
npm install
npm run build --workspace=@agentstore/agent-sandbox-service
OPENSHELL_SERVICE_TOKEN=dev-token npm run start --workspace=@agentstore/agent-sandbox-service
```

This requires `openshell` on `PATH` and a registered identity locally — see
the plan's Stage B1 manual CLI spike. Without that, `POST /sessions` will
fail with a clear "openshell CLI not found" or auth error rather than
silently doing nothing.

## Deploy

```bash
podman build -t agent-sandbox-service:dev -f apps/agent-sandbox-service/Containerfile .
# push somewhere your cluster can pull, then:
oc apply -f deploy/openshift/agent-sandbox-service.yaml
```

Set the Route's URL as `openshellServiceUrl` in Admin → Platform, and the
same token you set as this pod's `OPENSHELL_SERVICE_TOKEN` into
Admin → Secrets → Agent Sandbox Service token.
