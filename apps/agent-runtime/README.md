# Agent Runtime (Generic Chat Agent)

The `runtime: "generic-chat"` container: a small chat server built on
`@agentstore/agent-core` (the same provider/MCP/tool-hop/skills code
`apps/web/src/server/drafting.ts` uses for Autonomous drafting). One image
is reused across every generic-chat listing — an admin's "Deploy to
OpenShift" action (see `ansible/provision-generic-agent.yml`) configures a
*new* Deployment+Service+Route from this same image with that listing's
own persona, skills, MCP servers, and model, rather than building a new
image per agent.

Unlike `apps/agent-sandbox-service` (ephemeral, one sandbox per Task), this
is a **persistent** process: an admin deploys it once per listing, and
every user who opens the Route's URL talks to the same running agent —
with their own private chat history, isolated by an httpOnly session
cookie (see `src/sessionStore.ts`).

## Surface

- `GET /health` — unauthenticated liveness check.
- `GET /` — a minimal, dependency-free HTML/JS chat page.
- `POST /api/chat` — `{ message: string }` → `{ reply: string }`. Runs
  `agent-core`'s `runTurn()` against this session's persisted message
  history + active skill ids, calling any connected MCP tools and the
  synthetic `load_skill` tool (progressive-disclosure skills) along the
  way.

## Configuration (hybrid: env vars + mounted file)

Flat scalars, from env vars (sensitive ones sourced from a Secret via
`secretKeyRef`):

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port (default `8080`) |
| `LISTING_NAME` | Shown in the chat page header; falls back to the mounted config's `listingName` |
| `PROVIDER_KIND` | `anthropic` \| `openai` \| `openai-compatible` \| `gemini` |
| `PROVIDER_BASE_URL` | Must be reachable from inside the cluster — no localhost rewriting happens anywhere in this path |
| `PROVIDER_DEFAULT_MODEL` | Model id/name for the chosen provider |
| `PROVIDER_API_KEY` | From the vault, sourced via `secretKeyRef` |

Structured, variable-length config, from a mounted JSON file (default
`/etc/agent/config.json`, override with `AGENT_CONFIG_FILE`) — shape is
`GenericAgentRuntimeConfig` in `packages/shared`:

```json
{
  "listingName": "Red Hat Customer Support",
  "introLines": ["You are ...", "..."],
  "skills": [{ "id": "...", "name": "...", "description": "...", "instructions": "...", "allowedTools": ["..."] }],
  "mcpServers": [{ "id": "...", "name": "...", "url": "https://...", "transport": "streamable-http", "authToken": "..." }]
}
```

`skills` ship with their full `instructions` (not just name/description)
because this process — not the console — is what resolves the synthetic
`load_skill` tool call. `introLines` + `skills` feed straight into
`agent-core`'s `buildSystemPrompt()`, so the system prompt this container
computes is built exactly the same way drafting.ts's is.

Without a mounted config file, the server still boots (for local testing)
with an empty persona/skills/MCP set — see the startup warning.

## Session persistence caveat

Sessions live in an in-memory `Map`, one process per pod. Same tradeoff
`apps/agent-sandbox-service`'s README documents: single-replica, pod-local,
lost on pod restart. Acceptable for v1; revisit with an external store
(Redis, etc.) only if this needs to scale beyond one replica per listing.

## Local build

```bash
npm install
npm run build --workspace=@agentstore/agent-runtime
AGENT_CONFIG_FILE=./example-config.json \
PROVIDER_KIND=openai-compatible PROVIDER_BASE_URL=http://localhost:11434/v1 \
  npm run start --workspace=@agentstore/agent-runtime
```

## Deploy

Built and deployed by `ansible/provision-generic-agent.yml` via AAP (see
`apps/web/src/server/deployments.ts`'s `POST /api/admin/listings/[id]/deploy`),
not run manually — but for a one-off local image build:

```bash
podman build -t agent-runtime:dev -f apps/agent-runtime/Containerfile .
```
