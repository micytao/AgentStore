import type { AapJobSummary, AapJobTemplate } from "@agentstore/shared";
import { aapControllerUrl, aapInsecureTls, aapJobUrl, aapToken, isAapConfigured } from "./config";
import { dispatcherFor } from "./tls";

/**
 * AAP 2.4+ fronts the controller behind an API Gateway, which nests the
 * controller's REST API under `/api/controller/v2/...` instead of the
 * legacy (pre-gateway / standalone Controller or Tower) `/api/v2/...`.
 * Both shapes are otherwise identical, so we probe the unauthenticated
 * `/api/` root descriptor once per controller URL — it always advertises
 * which sub-APIs exist (`{"apis": {"controller": "/api/controller/", ...}}`
 * on gateway installs) — and cache whichever prefix applies. Every call
 * site below just asks for `/v2/...` and lets `aapFetch` prepend the right
 * base.
 */
let cachedPrefix: { base: string; prefix: string } | null = null;

async function controllerApiPrefix(base: string, dispatcher: ReturnType<typeof dispatcherFor>): Promise<string> {
  if (cachedPrefix?.base === base) return cachedPrefix.prefix;
  let prefix = "/api"; // legacy: /api/v2/... is the controller API directly
  try {
    const res = await fetch(`${base}/api/`, {
      headers: { Accept: "application/json" },
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);
    if (res.ok) {
      const body = (await res.json()) as { apis?: Record<string, string> };
      const controllerPath = body.apis?.controller;
      if (controllerPath) prefix = controllerPath.replace(/\/$/, "");
    }
  } catch {
    // Root descriptor probe failed (network hiccup, very old AAP without it,
    // etc.) — fall back to the legacy prefix rather than blocking the call.
  }
  cachedPrefix = { base, prefix };
  return prefix;
}

async function aapFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = aapControllerUrl();
  const token = aapToken();
  if (!base || !token) {
    throw new Error("AAP controller URL or token is not configured");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const dispatcher = dispatcherFor(aapInsecureTls());
  const prefix = await controllerApiPrefix(base, dispatcher);
  return fetch(`${base}${prefix}${path}`, {
    ...init,
    headers,
    ...(dispatcher ? { dispatcher } : {}),
  } as RequestInit);
}

export async function pingAap(): Promise<{ ok: boolean; error?: string }> {
  if (!isAapConfigured()) {
    return { ok: false, error: "AAP controller URL or token is missing" };
  }
  try {
    const response = await aapFetch("/v2/ping/");
    if (!response.ok) return { ok: false, error: `AAP ping returned ${response.status}` };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
    if (/self.signed|self signed|certificate/i.test(`${message} ${cause}`)) {
      return {
        ok: false,
        error:
          "TLS certificate rejected — check \"Allow self-signed certificate\" below if you trust this AAP instance.",
      };
    }
    return { ok: false, error: cause ? `${message}: ${cause}` : message };
  }
}

export async function listJobTemplates(): Promise<AapJobTemplate[]> {
  const response = await aapFetch("/v2/job_templates/?page_size=100&order_by=name");
  if (!response.ok) throw new Error(`AAP job templates: HTTP ${response.status}`);
  const body = (await response.json()) as { results?: { id: number; name: string }[] };
  return (body.results ?? []).map((row) => ({ id: row.id, name: row.name }));
}

export async function listRecentJobs(limit = 15): Promise<AapJobSummary[]> {
  const response = await aapFetch(`/v2/jobs/?page_size=${limit}&order_by=-id`);
  if (!response.ok) throw new Error(`AAP jobs: HTTP ${response.status}`);
  const body = (await response.json()) as {
    results?: {
      id: number;
      name: string;
      status: string;
      started?: string | null;
      finished?: string | null;
    }[];
  };
  return (body.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    started: row.started ?? undefined,
    finished: row.finished ?? undefined,
    url: aapJobUrl(row.id),
  }));
}

export async function launchJobTemplate(
  templateId: number,
  extraVars: Record<string, unknown>
): Promise<{ id: number }> {
  const response = await aapFetch(`/v2/job_templates/${templateId}/launch/`, {
    method: "POST",
    body: JSON.stringify({ extra_vars: extraVars }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AAP launch failed (${response.status}): ${text.slice(0, 400)}`);
  }
  const body = (await response.json()) as { id?: number; job?: number };
  const id = body.job ?? body.id;
  if (!id) throw new Error("AAP launch succeeded but returned no job id");
  return { id };
}

export async function getJob(id: string | number): Promise<{
  id: number;
  status: string;
  name: string;
}> {
  const response = await aapFetch(`/v2/jobs/${id}/`);
  if (!response.ok) throw new Error(`AAP job ${id}: HTTP ${response.status}`);
  return (await response.json()) as { id: number; status: string; name: string };
}

export async function cancelJob(id: string | number): Promise<void> {
  const response = await aapFetch(`/v2/jobs/${id}/cancel/`, { method: "POST" });
  if (!response.ok && response.status !== 405) {
    throw new Error(`AAP cancel job ${id}: HTTP ${response.status}`);
  }
}
