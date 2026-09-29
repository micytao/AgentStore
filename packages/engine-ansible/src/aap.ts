import type { AapJobSummary, AapJobTemplate, AapNamedObject } from "@agentstore/shared";
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
  // Every call here is live AAP state (job/project-sync status, lists
  // that change as objects are created) — Next.js's App Router patches
  // the global fetch() to cache GET requests by default, which would
  // otherwise make repeated polls (e.g. job/project-sync status) return
  // a stale snapshot instead of fresh data.
  return fetch(`${base}${prefix}${path}`, {
    ...init,
    headers,
    cache: "no-store",
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

// --- Job Template bootstrap -------------------------------------------
//
// The rest of this file creates the AAP objects (Organization lookup,
// Project, Inventory+Host, Kubernetes credential, Job Templates) that
// genericAgentDeploy.ts/gatewayDeploy.ts already know how to launch by
// id — see jobTemplateBootstrap.ts one level up for the orchestration
// that calls these in order. Every "create" here is a find-or-create
// keyed by name, so re-running the whole bootstrap after changing an
// input (e.g. a new Git branch, a different EE) is always safe.

async function findByName(path: string, name: string): Promise<{ id: number } | undefined> {
  const response = await aapFetch(`${path}?name=${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`AAP GET ${path}: HTTP ${response.status}`);
  const body = (await response.json()) as { results?: { id: number }[] };
  return body.results?.[0];
}

/** Organizations are looked up, never created — creating one can require
 * elevated RBAC beyond what a scoped automation token has, and every AAP
 * install ships a usable one ("Default") out of the box. */
export async function findOrganizationByName(name: string): Promise<{ id: number }> {
  const org = await findByName("/v2/organizations/", name);
  if (!org) {
    throw new Error(
      `AAP organization "${name}" not found — it must already exist (this bootstrap looks organizations up, it does not create them).`
    );
  }
  return org;
}

export async function listExecutionEnvironments(): Promise<AapNamedObject[]> {
  const response = await aapFetch("/v2/execution_environments/?page_size=100&order_by=name");
  if (!response.ok) throw new Error(`AAP execution environments: HTTP ${response.status}`);
  const body = (await response.json()) as { results?: { id: number; name: string }[] };
  return (body.results ?? []).map((row) => ({ id: row.id, name: row.name }));
}

/** For the Organization `FormSelect` on the "Create job templates" card
 * — real options instead of a free-text field the admin has to get
 * exactly right, since findOrganizationByName() only ever looks these
 * up (never creates one). */
export async function listOrganizations(): Promise<AapNamedObject[]> {
  const response = await aapFetch("/v2/organizations/?page_size=100&order_by=name");
  if (!response.ok) throw new Error(`AAP organizations: HTTP ${response.status}`);
  const body = (await response.json()) as { results?: { id: number; name: string }[] };
  return (body.results ?? []).map((row) => ({ id: row.id, name: row.name }));
}

/** For the Project `FormSelect` on the same card — lets the admin reuse
 * an existing Project by picking its real name instead of retyping it
 * from memory; findOrCreateProject() still just finds-by-name underneath,
 * so picking an existing one here and typing a brand new one both work
 * the same way. */
export async function listProjects(): Promise<AapNamedObject[]> {
  const response = await aapFetch("/v2/projects/?page_size=100&order_by=name");
  if (!response.ok) throw new Error(`AAP projects: HTTP ${response.status}`);
  const body = (await response.json()) as { results?: { id: number; name: string }[] };
  return (body.results ?? []).map((row) => ({ id: row.id, name: row.name }));
}

async function credentialTypeIdForKind(kind: string): Promise<number> {
  const response = await aapFetch(`/v2/credential_types/?kind=${encodeURIComponent(kind)}&page_size=1`);
  if (!response.ok) throw new Error(`AAP credential types: HTTP ${response.status}`);
  const body = (await response.json()) as { results?: { id: number }[] };
  const id = body.results?.[0]?.id;
  if (!id) throw new Error(`AAP has no credential type of kind "${kind}"`);
  return id;
}

/** For the optional "SCM credential" dropdown (private Project repos). */
export async function listCredentialsByKind(kind: string): Promise<AapNamedObject[]> {
  const typeId = await credentialTypeIdForKind(kind);
  const response = await aapFetch(`/v2/credentials/?credential_type=${typeId}&page_size=100&order_by=name`);
  if (!response.ok) throw new Error(`AAP credentials: HTTP ${response.status}`);
  const body = (await response.json()) as { results?: { id: number; name: string }[] };
  return (body.results ?? []).map((row) => ({ id: row.id, name: row.name }));
}

export interface FindOrCreateExecutionEnvironmentInput {
  name: string;
  image: string;
  /** Container Registry (kind "registry") credential id, for a private
   * image. Omit for a public image. */
  credentialId?: number;
}

/**
 * Registers an already-built-and-pushed container image as an AAP
 * Execution Environment object — the one step of the EE story the AAP
 * API *can* do (building/pushing the image itself can't, see
 * ansible/execution-environment/README.md). Idempotent by name: calling
 * this again with a new `image` for the same `name` updates it in place
 * (e.g. re-tagging `:latest` to a pinned digest later).
 */
export async function findOrCreateExecutionEnvironment(
  input: FindOrCreateExecutionEnvironmentInput
): Promise<{ id: number }> {
  const fields = {
    name: input.name,
    image: input.image,
    pull: "missing",
    credential: input.credentialId,
  };
  const existing = await findByName("/v2/execution_environments/", input.name);
  if (existing) {
    const patched = await aapFetch(`/v2/execution_environments/${existing.id}/`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
    if (!patched.ok) {
      const text = await patched.text();
      throw new Error(`AAP update execution environment failed (${patched.status}): ${text.slice(0, 400)}`);
    }
    return existing;
  }
  const response = await aapFetch("/v2/execution_environments/", {
    method: "POST",
    body: JSON.stringify(fields),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AAP create execution environment failed (${response.status}): ${text.slice(0, 400)}`);
  }
  return (await response.json()) as { id: number };
}

export interface FindOrCreateProjectInput {
  name: string;
  organizationId: number;
  scmUrl: string;
  scmBranch: string;
  scmCredentialId?: number;
}

export async function findOrCreateProject(input: FindOrCreateProjectInput): Promise<{ id: number }> {
  const existing = await findByName("/v2/projects/", input.name);
  if (existing) return existing;
  const response = await aapFetch("/v2/projects/", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      organization: input.organizationId,
      scm_type: "git",
      scm_url: input.scmUrl,
      scm_branch: input.scmBranch,
      credential: input.scmCredentialId,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AAP create project failed (${response.status}): ${text.slice(0, 400)}`);
  }
  return (await response.json()) as { id: number };
}

/** Kicks off an async SCM sync; see getProjectUpdateStatus() to poll it. */
export async function syncProject(projectId: number): Promise<{ projectUpdateId: number }> {
  const response = await aapFetch(`/v2/projects/${projectId}/update/`, { method: "POST" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AAP project sync failed (${response.status}): ${text.slice(0, 400)}`);
  }
  const body = (await response.json()) as { id?: number; project_update?: number };
  const id = body.id ?? body.project_update;
  if (!id) throw new Error("AAP project sync started but returned no update id");
  return { projectUpdateId: id };
}

export async function getProjectUpdateStatus(updateId: number): Promise<{ status: string }> {
  const response = await aapFetch(`/v2/project_updates/${updateId}/`);
  if (!response.ok) throw new Error(`AAP project update ${updateId}: HTTP ${response.status}`);
  const body = (await response.json()) as { status: string };
  return { status: body.status };
}

export interface FindOrCreateInventoryInput {
  name: string;
  organizationId: number;
}

export async function findOrCreateInventory(input: FindOrCreateInventoryInput): Promise<{ id: number }> {
  const existing = await findByName("/v2/inventories/", input.name);
  if (existing) return existing;
  const response = await aapFetch("/v2/inventories/", {
    method: "POST",
    body: JSON.stringify({ name: input.name, organization: input.organizationId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AAP create inventory failed (${response.status}): ${text.slice(0, 400)}`);
  }
  return (await response.json()) as { id: number };
}

/** Both playbooks run `hosts: localhost` — this is the one host the
 * bootstrap's Inventory needs, run via the AAP execution node itself
 * (not SSH'd into), talking to the OpenShift API over HTTPS. */
export async function findOrCreateLocalhostHost(inventoryId: number): Promise<{ id: number }> {
  const response = await aapFetch(`/v2/inventories/${inventoryId}/hosts/?name=localhost`);
  if (!response.ok) throw new Error(`AAP list hosts: HTTP ${response.status}`);
  const existing = ((await response.json()) as { results?: { id: number }[] }).results?.[0];
  if (existing) return existing;
  const created = await aapFetch(`/v2/inventories/${inventoryId}/hosts/`, {
    method: "POST",
    body: JSON.stringify({ name: "localhost", variables: "ansible_connection: local" }),
  });
  if (!created.ok) {
    const text = await created.text();
    throw new Error(`AAP create host failed (${created.status}): ${text.slice(0, 400)}`);
  }
  return (await created.json()) as { id: number };
}

export interface FindOrCreateKubernetesCredentialInput {
  name: string;
  organizationId: number;
  apiUrl: string;
  bearerToken: string;
  verifySsl: boolean;
}

/**
 * Creates (or updates, if it already exists by name) the "OpenShift or
 * Kubernetes API Bearer Token" credential both Job Templates attach —
 * AAP injects K8S_AUTH_HOST/K8S_AUTH_API_KEY/K8S_AUTH_VERIFY_SSL env vars
 * from it, which is how the playbooks' bare `kubernetes.core.k8s` tasks
 * (no explicit host/api_key module params) authenticate against the
 * cluster. Reuses the OpenShift URL/token AgentStore already has in
 * PlatformSettings/the vault — no new secret to manage.
 */
export async function findOrCreateKubernetesCredential(
  input: FindOrCreateKubernetesCredentialInput
): Promise<{ id: number }> {
  const typeId = await credentialTypeIdForKind("kubernetes");
  const inputs = {
    host: input.apiUrl,
    bearer_token: input.bearerToken,
    verify_ssl: input.verifySsl,
  };
  const existing = await findByName("/v2/credentials/", input.name);
  if (existing) {
    const patched = await aapFetch(`/v2/credentials/${existing.id}/`, {
      method: "PATCH",
      body: JSON.stringify({ inputs }),
    });
    if (!patched.ok) {
      const text = await patched.text();
      throw new Error(`AAP update credential failed (${patched.status}): ${text.slice(0, 400)}`);
    }
    return existing;
  }
  const response = await aapFetch("/v2/credentials/", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      organization: input.organizationId,
      credential_type: typeId,
      inputs,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AAP create credential failed (${response.status}): ${text.slice(0, 400)}`);
  }
  return (await response.json()) as { id: number };
}

export interface FindOrCreateJobTemplateInput {
  name: string;
  projectId: number;
  playbook: string;
  inventoryId: number;
  executionEnvironmentId: number;
}

/** ask_variables_on_launch is always set: both playbooks require a
 * different extra_vars payload per launch (per-listing for the
 * autonomous template, platform-scoped for the collaborative one), the
 * same way this Job Template would need it if hand-created in the AAP
 * UI per ansible/README.md. */
/** `created` tells the caller whether this call actually made a new
 * object (a fresh AAP `POST`) or just found-and-verified one that was
 * already there (an existing-by-name `PATCH`) — surfaced up through
 * `AapBootstrapStatus` so the "Create job templates" UI can tell the
 * admin which one happened, instead of a generic "ready" that reads the
 * same whether anything changed or not. */
export async function findOrCreateJobTemplate(
  input: FindOrCreateJobTemplateInput
): Promise<{ id: number; created: boolean }> {
  const fields = {
    name: input.name,
    job_type: "run",
    project: input.projectId,
    playbook: input.playbook,
    inventory: input.inventoryId,
    execution_environment: input.executionEnvironmentId,
    ask_variables_on_launch: true,
  };
  const existing = await findByName("/v2/job_templates/", input.name);
  if (existing) {
    const patched = await aapFetch(`/v2/job_templates/${existing.id}/`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
    if (!patched.ok) {
      const text = await patched.text();
      throw new Error(`AAP update job template failed (${patched.status}): ${text.slice(0, 400)}`);
    }
    return { id: existing.id, created: false };
  }
  const response = await aapFetch("/v2/job_templates/", {
    method: "POST",
    body: JSON.stringify(fields),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AAP create job template failed (${response.status}): ${text.slice(0, 400)}`);
  }
  const row = (await response.json()) as { id: number };
  return { id: row.id, created: true };
}

/** Idempotent by checking first, not by relying on AAP to treat a repeat
 * POST as a no-op: for credential types that only allow one per job
 * template — like the Kubernetes/OpenShift API Bearer Token type used
 * here — AAP's `/credentials/` association endpoint enforces that
 * uniqueness rule on *every* POST, even when the id being posted is the
 * exact same credential already attached. So re-running this (e.g. the
 * admin clicks "Create job templates" again once it's already
 * bootstrapped) throws `400 Cannot assign multiple OpenShift or
 * Kubernetes API Bearer Token credentials.` instead of a no-op 204/201 —
 * this checks the current associations first and skips the POST if
 * `credentialId` is already among them. */
export async function attachCredentialToJobTemplate(
  jobTemplateId: number,
  credentialId: number
): Promise<void> {
  const existing = await aapFetch(`/v2/job_templates/${jobTemplateId}/credentials/?page_size=200`);
  if (existing.ok) {
    const body = (await existing.json()) as { results?: { id: number }[] };
    if (body.results?.some((c) => c.id === credentialId)) return;
  }
  const response = await aapFetch(`/v2/job_templates/${jobTemplateId}/credentials/`, {
    method: "POST",
    body: JSON.stringify({ id: credentialId }),
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`AAP attach credential failed (${response.status}): ${text.slice(0, 400)}`);
  }
}
