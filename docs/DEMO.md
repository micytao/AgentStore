# Agent Store — demo walkthrough

This is the leadership/demo script for the prototype. It exercises every
"real" path in the app (not just UI mockups): a server-tracked Admin role,
Autonomous drafting against an actual model provider (including a
self-hosted vLLM MaaS with no API key), a real MCP tool call, per-agent
provider/tool/skill binding, and the full agent onboarding workflow —
admin creates a new agent, publishes it, and it becomes visible to a
regular user.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. There is no login screen; every task is
attributed to `Demo` (see `docs/DEFERRED.md` for real multi-user SSO).
Click the **Demo** chip at the bottom of the sidebar to switch to **Admin**
— see step 4.

## 1. Browse the catalog as a regular user

Catalog → filter by department. Only **published** listings show up here —
this is enforced server-side in `GET /api/listings` (`apps/web/src/app/api/listings/route.ts`),
not just hidden by a UI flag.

## 2. Autonomous mode (A) — draft, review, approve

1. Catalog → Customer Support → **Draft a ticket reply** → Launch.
2. Goal: `Draft a reply to INC-1042 about a billing outage`.
3. Wait for **AwaitingApproval**, read the draft, Approve or Reject.

With no model provider configured, the draft is simulated canned text. Once
a provider is added and activated (step 5), the same flow produces a real
model-generated draft instead — nothing else about the flow changes.

## 3. Collaborative mode (C) — claim and work live

1. Catalog → Engineering → **Claude Code** → Launch.
2. Wait until status is Running, then type in the terminal.
3. Stop the session. The task appears under **My Tasks**.

Without `OPENSHELL_GATEWAY_URL`, this is a simulated session (clearly
labeled). With the gateway set and `openshell` on `PATH`, it's a real
sandbox. "Booking" an agent in this prototype means claim-and-launch a live
session now — there's no capacity/queueing model (see `docs/DEFERRED.md`).

## 4. Switch to Admin

Click the **Demo** chip at the bottom of the sidebar — it flips to **Admin**
immediately, no passcode or login. This is a demo convenience, not access
control (see `docs/DEFERRED.md`): it sets a signed, `httpOnly` session
cookie, and every `/api/admin/**` route calls `requireAdmin()`
(`apps/web/src/server/auth.ts`) and rejects with `401` if it's missing —
so the role is a real server-side fact the API checks, even though nothing
gates who can flip it. Click the chip again to switch back to Demo.

## 5. Add a real Model-as-a-Service provider (vLLM, no API key)

This is the "I have a MaaS working properly" path made first-class.

1. Start your vLLM server (self-hosted, OpenAI-compatible), e.g.:
   ```bash
   vllm serve <your-model> --port 8000
   ```
   (or via the `user-vllm` MCP tooling: `start_vllm`).
2. **Admin → Providers → + Add provider** → click the **Self-hosted / vLLM
   (MaaS)** quick preset. It pre-fills kind = "OpenAI-compatible" and Base
   URL = `http://localhost:8000/v1`. Give it a label and add it.
3. Click **Test connection** — no API key required; the button is enabled
   for OpenAI-compatible providers even with none set. This hits your real
   vLLM server's `/v1/models` endpoint.
4. Click **Activate**. Autonomous drafts now call your real vLLM server
   (`apps/web/src/server/drafting.ts` → `providers.ts`, no `Authorization`
   header sent when no key is configured) instead of the simulated
   fallback. Re-run step 2 to see a real generated draft.

Anthropic/OpenAI/Gemini providers work the same way but require a real API
key (**Admin → Providers → Save key**, backed by the encrypted vault in
**Admin → Secrets**).

## 6. Author a skill

**Admin → Skills → + Add skill**. A skill is a reusable instruction bundle
(name + instructions text) merged into an agent's system prompt when it
drafts. Add one, e.g. "Always close with a next-step checklist."

## 7. Onboard a brand-new agent end to end

This is the "submit a new app to the store" workflow — distinct from
editing the six built-in demo listings.

1. **Admin → Catalog → + Onboard new agent**.
2. **Basics** — name, department, category, description, icon, risk tier.
3. **Modes & engine** — pick Autonomous and/or Collaborative, engine type
   (hosted agent API vs. self-hosted OpenShell sandbox), and an engine
   override (auto / force simulated / force live).
4. **Model & tools** — bind the vLLM (or any) provider from step 5, and any
   connected MCP tools you want this specific agent allowed to call.
5. **Skills** — attach the skill from step 6.
6. **Review & publish** — see the exact `ListingCard` users will see, then
   either **Save as draft** (invisible to regular users, still visible to
   admins for preview) or **Publish now**.
7. Click the sidebar chip to switch back to **Demo**. The new agent now
   shows up in the regular Catalog — provided you published it. If you saved it as a draft, it's
   invisible until an admin flips its Review status to `published` (either
   from the wizard's "Publish now" or later from the Catalog tab's listing
   row). This round trip — onboard → publish → real user sees it — is
   enforced server-side (`GET /api/listings`, `POST /api/tasks`), not just
   a UI convention.
8. Launch a task against the new agent as a regular user to see the bound
   provider/tools/skills actually used.

You can also **Retire** (delete) any agent created through the wizard from
the Catalog tab; the six built-in demo listings are edit-only.

## 8. Durability check

Restart `npm run dev`. Task history (`.data/tasks.json`), built-in-listing
edits (`.data/catalog-overrides.json`), custom agents
(`.data/custom-listings/*.yaml`), providers, MCP servers, skills, and
secrets all survive the restart — everything is file-backed, no database
required for this phase (see `docs/DEFERRED.md`).
