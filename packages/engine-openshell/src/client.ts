import type { OpenShellMcpServerConfig, OpenShellModelConfig } from "@agentstore/shared";
import { isOpenShellServiceConfigured, openshellServiceToken, openshellServiceUrl } from "./config";

/**
 * Thin REST client for the Agent Sandbox Service — same shape as
 * packages/engine-ansible/src/aap.ts's relationship to the real AAP API.
 * No CLI, no file uploads, no node-pty on the console side; this package
 * only ever makes `fetch` calls.
 */

export interface RemoteSession {
  id: string;
  phase: "Provisioning" | "Running" | "Failed" | "Cancelled";
  message?: string;
}

export interface CreateSessionRequest {
  taskId: string;
  agent: string;
  model?: OpenShellModelConfig;
  mcpServers?: OpenShellMcpServerConfig[];
  gitUrl?: string;
  gitToken?: string;
}

async function serviceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!isOpenShellServiceConfigured()) {
    throw new Error(
      "OPENSHELL_SERVICE_URL / OPENSHELL_SERVICE_TOKEN are not configured. Set the Agent Sandbox Service URL on Admin -> Platform and its token on Admin -> Secrets."
    );
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${openshellServiceToken()}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${openshellServiceUrl()}${path}`, { ...init, headers });
}

async function parseOrThrow<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: string };
      detail = body.error ?? "";
    } catch {
      /* ignore non-JSON error body */
    }
    throw new Error(`Agent Sandbox Service ${action} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
  }
  return (await response.json()) as T;
}

export async function createSession(input: CreateSessionRequest): Promise<RemoteSession> {
  const response = await serviceFetch("/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return parseOrThrow<RemoteSession>(response, "create session");
}

export async function getSession(id: string): Promise<RemoteSession> {
  const response = await serviceFetch(`/sessions/${encodeURIComponent(id)}`);
  return parseOrThrow<RemoteSession>(response, "get session");
}

export async function deleteSession(id: string): Promise<void> {
  const response = await serviceFetch(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  await parseOrThrow<{ ok: boolean }>(response, "delete session");
}

export async function mintTerminalToken(id: string): Promise<{ url: string }> {
  const response = await serviceFetch(`/sessions/${encodeURIComponent(id)}/terminal-token`, {
    method: "POST",
  });
  return parseOrThrow<{ url: string }>(response, "mint terminal token");
}

export async function pingOpenShellService(): Promise<{ ok: boolean; error?: string }> {
  if (!openshellServiceUrl()) return { ok: false, error: "Not configured" };
  try {
    const response = await fetch(`${openshellServiceUrl()}/health`);
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
