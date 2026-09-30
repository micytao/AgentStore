# Agent Sandbox Service

Owns every OpenShell sandbox lifecycle + terminal relay mechanic behind a
small REST + WebSocket API, so the AgentStore console
(`packages/engine-openshell`) never runs the `openshell` CLI or manages
gRPC connections itself. Deployed once, in-cluster, next to the OpenShell
gateway.

Uses `@nvidia/openshell-sdk` (the official TypeScript gRPC client) for all
gateway communication — no CLI binary, no `node-pty`, no native build
toolchain in the image.

## Architecture — the tmux trick

The SDK's `execInteractive` always spawns an *independent sibling process*,
never reattaching to the sandbox's canonical main process (unlike the CLI's
`sandbox connect`). To recover equivalent reattach semantics:

1. **Create** wraps the agent command in tmux:
   `command: ["tmux", "new-session", "-s", "main", "--", "opencode"]`
2. **Open terminal** runs a sibling exec that attaches to the same tmux
   session: `execInteractive(name, ["tmux", "attach", "-t", "main"])`

This gives multi-attach, disconnect/reconnect, and output replay — all
through the SDK, with zero CLI dependency.

## API

All `/sessions*` routes require `Authorization: Bearer $OPENSHELL_SERVICE_TOKEN`.

- `GET /health` — unauthenticated liveness check.
- `POST /sessions` — `{ taskId, agent, model?, mcpServers?, gitUrl?, gitToken? }` → `{ id, phase }`.
- `GET /sessions/:id` — `{ id, phase, message? }`, wraps `client.sandbox.get()`.
- `DELETE /sessions/:id` — cancels any terminal session, then `client.sandbox.delete()`.
- `POST /sessions/:id/terminal-token` — `{ url }`, a `wss://` URL with a short-lived signed token.
- `WS /sessions/:id/terminal?token=...` — verifies the token, starts `execInteractive(name, ["tmux","attach","-t","main"])`, relays bytes both ways. Send `{"type":"resize","cols":N,"rows":N}` as a text frame to resize.

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port (default `8090`) |
| `OPENSHELL_SERVICE_TOKEN` | Bearer token the console must present. **Required**. |
| `OPENSHELL_GATEWAY_URL` | In-cluster gateway URL, e.g. `http://openshell-gateway.openshell:8080`. **Required**. |
| `OPENSHELL_DEFAULT_SANDBOX_IMAGE` | Default sandbox image (default `ghcr.io/anomalyco/opencode:latest`) |
| `OPENSHELL_OIDC_ISSUER` | OIDC issuer URL (production gateways only) |
| `OPENSHELL_OIDC_CLIENT_ID` | OIDC client ID (production gateways only) |
| `OPENSHELL_OIDC_CLIENT_SECRET` | OIDC client secret (production gateways only) |
| `TERMINAL_TOKEN_SECRET` | HMAC key for terminal tokens (falls back to `OPENSHELL_SERVICE_TOKEN`) |
| `TERMINAL_TOKEN_TTL_MS` | Terminal token lifetime (default 5 min) |
| `TERMINAL_IDLE_TIMEOUT_MS` | Kill an unattached terminal after this long (default 30 min) |
| `TERMINAL_PUBLIC_PROTOCOL` | `wss` (default) or `ws` for local plaintext |

When all three OIDC env vars are set, the SDK uses a renewable
client-credentials grant (auto-refreshing, in-memory). When unset (eval-mode
gateway with `server.disableTls: true`), it connects without auth.

## Local build

```bash
npm install
npm run build --workspace=@agentstore/agent-sandbox-service
OPENSHELL_SERVICE_TOKEN=dev-token OPENSHELL_GATEWAY_URL=http://localhost:8080 \
  npm run start --workspace=@agentstore/agent-sandbox-service
```

Note: `npm install` requires a GitHub token with `read:packages` scope for
`@nvidia/openshell-sdk` (published on GitHub Packages). Set `GITHUB_TOKEN`
in your environment or run `npm login --registry=https://npm.pkg.github.com`.

## Deploy

```bash
podman build -t agent-sandbox-service:dev -f apps/agent-sandbox-service/Containerfile .
# push somewhere your cluster can pull, then:
oc apply -f deploy/openshift/agent-sandbox-service.yaml
```

Set the Route's URL as `openshellServiceUrl` in Admin → Platform, and the
same token as this pod's `OPENSHELL_SERVICE_TOKEN` into Admin → Secrets.
