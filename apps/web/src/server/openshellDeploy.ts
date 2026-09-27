import type { Listing, OpenShellSessionState } from "@agentstore/shared";
import * as client from "@agentstore/engine-openshell";
import { isOpenShellServiceConfigured } from "@agentstore/engine-openshell";
import { getListing, updateListing } from "./catalog";
import { mcpServersFor, openshellModelFor } from "./agentRuntimeConfig";
import { getSecret } from "./secrets";

/**
 * The OpenShell runtime's "deploy once" admin action — the collaborative-
 * agent equivalent of deployments.ts's generic-chat flow. Creates a single
 * persistent Agent Sandbox Service session per listing (keyed by the
 * listing's own id) instead of a fresh sandbox per launch, and persists
 * progress onto the listing's `openshellSession` field. Every "Open
 * terminal" click mints a fresh short-lived token against that same
 * session — see the terminal-endpoint route.
 *
 * apps/agent-sandbox-service and packages/engine-openshell needed no
 * changes for this: `createSession`/`getSession`/`deleteSession`/
 * `mintTerminalToken` already just key a sandbox by whatever id is passed
 * as `taskId` — here that's the listing id instead of a per-launch task id.
 */

function now(): string {
  return new Date().toISOString();
}

function persistSession(id: string, session: OpenShellSessionState): Listing {
  const updated = updateListing(id, { openshellSession: session });
  if (!updated) throw new Error(`Unknown listing: ${id}`);
  return updated;
}

function phaseToStatus(phase: client.RemoteSession["phase"]): OpenShellSessionState["status"] {
  switch (phase) {
    case "Provisioning":
      return "deploying";
    case "Running":
      return "running";
    case "Failed":
      return "failed";
    case "Cancelled":
      return "not-deployed";
  }
}

/** Starts (or re-starts, e.g. after a failure) this listing's persistent
 * OpenShell sandbox session. Persists an initial "deploying" state
 * immediately and returns; the Admin UI polls refreshOpenShellSession()
 * for progress, same inline-progress pattern deployments.ts's
 * startDeployment() uses for the generic-chat AAP job. */
export async function startOpenShellSession(listingId: string): Promise<Listing> {
  const listing = getListing(listingId);
  if (!listing) throw new Error(`Unknown listing: ${listingId}`);
  if (listing.runtime !== "openshell") {
    throw new Error(`"${listing.name}" is not an openshell runtime listing.`);
  }
  if (!isOpenShellServiceConfigured()) {
    throw new Error(
      "Agent Sandbox Service is not configured — set its URL and token in Admin → LLMs → OpenShell."
    );
  }

  const session = await client.createSession({
    taskId: listing.id,
    agent: listing.openshellAgent ?? "opencode",
    model: openshellModelFor(listing),
    mcpServers: mcpServersFor(listing),
    gitUrl: listing.agentConfig?.gitUrl,
    gitToken: listing.agentConfig?.gitUrl ? getSecret("GIT_PAT") : undefined,
  });

  return persistSession(listingId, {
    status: session.phase === "Failed" ? "failed" : "deploying",
    sandboxId: session.id,
    error: session.phase === "Failed" ? session.message : undefined,
    updatedAt: now(),
  });
}

/** Polls the in-flight session (if any) and updates the persisted
 * `openshellSession`. A no-op that just returns the listing unchanged when
 * there's nothing to poll (no session yet, or already running/failed) —
 * safe for the Admin UI to call on an interval. */
export async function refreshOpenShellSession(listingId: string): Promise<Listing> {
  const listing = getListing(listingId);
  if (!listing) throw new Error(`Unknown listing: ${listingId}`);

  const session = listing.openshellSession;
  if (!session || session.status !== "deploying" || !session.sandboxId) {
    return listing;
  }

  const remote = await client.getSession(session.sandboxId);
  return persistSession(listingId, {
    ...session,
    status: phaseToStatus(remote.phase),
    error: remote.phase === "Failed" ? remote.message : undefined,
    updatedAt: now(),
  });
}

/** Server-side only: mints a fresh terminal URL/token for this listing's
 * sandbox session. Called from the terminal-endpoint API route rather than
 * exposed as a plain field on Listing, so the Agent Sandbox Service's
 * URL/token never sit in a client-visible payload until a short-lived
 * token is actually minted for this specific request. */
export async function getOpenShellTerminalEndpoint(
  listingId: string
): Promise<{ url: string } | null> {
  const listing = getListing(listingId);
  if (!listing?.openshellSession?.sandboxId) return null;
  if (listing.openshellSession.status !== "running") return null;
  return client.mintTerminalToken(listing.openshellSession.sandboxId);
}

/** Tears down this listing's sandbox session (e.g. before a redeploy, or
 * if an admin explicitly stops it). */
export async function stopOpenShellSession(listingId: string): Promise<Listing> {
  const listing = getListing(listingId);
  if (!listing) throw new Error(`Unknown listing: ${listingId}`);
  if (listing.openshellSession?.sandboxId) {
    await client.deleteSession(listing.openshellSession.sandboxId).catch(() => undefined);
  }
  return persistSession(listingId, { status: "not-deployed", updatedAt: now() });
}
