import { randomUUID } from "node:crypto";
import { createChatState, trimHistory, type ChatState } from "@agentstore/agent-core";

/**
 * Cookie-keyed, in-memory, per-pod session store — new code, not extracted
 * from anywhere, since drafting.ts's one-shot Autonomous drafts never
 * needed multi-turn history. Each browser gets its own httpOnly cookie on
 * first visit, mapping to its own message history + active skill ids.
 *
 * Same caveat this repo already documents for the Agent Sandbox Service
 * (see its README): single-replica, pod-local, session lost on pod
 * restart or if the Deployment ever scales beyond one replica — acceptable
 * for v1, not solved with an external store.
 */

export const SESSION_COOKIE_NAME = "agentstore_session";
const SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_MESSAGES = 40;

interface SessionEntry {
  state: ChatState;
  updatedAt: number;
}

const sessions = new Map<string, SessionEntry>();

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export interface Session {
  id: string;
  state: ChatState;
  isNew: boolean;
}

export function getOrCreateSession(cookieHeader: string | undefined): Session {
  const existingId = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (existingId) {
    const entry = sessions.get(existingId);
    if (entry) {
      entry.updatedAt = Date.now();
      return { id: existingId, state: entry.state, isNew: false };
    }
  }
  const id = randomUUID();
  const state = createChatState();
  sessions.set(id, { state, updatedAt: Date.now() });
  return { id, state, isNew: true };
}

/** Sliding-window trim + touch, called once a turn has finished running. */
export function touchSession(id: string): void {
  const entry = sessions.get(id);
  if (!entry) return;
  trimHistory(entry.state, MAX_HISTORY_MESSAGES);
  entry.updatedAt = Date.now();
}

export function setCookieHeader(id: string): string {
  return `${SESSION_COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_IDLE_TTL_MS / 1000)}`;
}

function sweepIdleSessions(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.updatedAt > SESSION_IDLE_TTL_MS) sessions.delete(id);
  }
}

const sweepTimer = setInterval(sweepIdleSessions, 10 * 60_000);
sweepTimer.unref?.();

export function sessionCount(): number {
  return sessions.size;
}
