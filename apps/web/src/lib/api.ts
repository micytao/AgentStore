import type {
  DepartmentId,
  EngineSettings,
  Listing,
  ListingCreateInput,
  ListingUpdate,
  McpServerConfig,
  McpServerStatus,
  PlatformSettings,
  PlatformStatus,
  ProviderConfig,
  ProviderStatus,
  SecretSummary,
  Skill,
} from "@agentstore/shared";

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? response.statusText);
  }
  return body as T;
}

export function fetchListings(department?: string): Promise<Listing[]> {
  const query =
    department && department !== "all" ? `?department=${department}` : "";
  return fetch(`/api/listings${query}`).then((r) => parse<Listing[]>(r));
}

export function updateListingAdmin(
  id: string,
  patch: ListingUpdate
): Promise<Listing> {
  return fetch(`/api/admin/listings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => parse<Listing>(r));
}

export function createListingAdmin(input: ListingCreateInput): Promise<Listing> {
  return fetch("/api/admin/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => parse<Listing>(r));
}

/** Deletes a listing. Also tears down any live deployment/session it owns
 * (see the DELETE route) — `warning` is set (deletion still succeeds) if
 * that teardown itself failed, e.g. the cluster was unreachable. */
export function deleteListingAdmin(id: string): Promise<{ warning?: string }> {
  return fetch(`/api/admin/listings/${id}`, { method: "DELETE" }).then((r) =>
    parse<{ ok: boolean; warning?: string }>(r)
  );
}

/** Starts (or re-starts) the "Deploy to OpenShift" AAP job for a
 * generic-chat listing. */
export function deployListingAdmin(id: string): Promise<Listing> {
  return fetch(`/api/admin/listings/${id}/deploy`, { method: "POST" }).then((r) =>
    parse<Listing>(r)
  );
}

/** Polls an in-flight deploy for progress; safe to call on an interval. */
export function fetchDeploymentStatus(id: string): Promise<Listing> {
  return fetch(`/api/admin/listings/${id}/deploy`).then((r) => parse<Listing>(r));
}

/** Tears down a generic-chat listing's deployment (Deployment/Service/
 * Route/Secret on OpenShift) — same DELETE convention as
 * stopOpenShellSession(). Resets to "not-deployed" so "Deploy to
 * OpenShift" reappears. */
export function stopDeploymentAdmin(id: string): Promise<Listing> {
  return fetch(`/api/admin/listings/${id}/deploy`, { method: "DELETE" }).then((r) =>
    parse<Listing>(r)
  );
}

/** Starts (or re-starts) an openshell listing's persistent sandbox session. */
export function startOpenShellSession(id: string): Promise<Listing> {
  return fetch(`/api/admin/listings/${id}/openshell-session`, { method: "POST" }).then((r) =>
    parse<Listing>(r)
  );
}

/** Polls an in-flight sandbox session for progress; safe to call on an interval. */
export function fetchOpenShellSessionStatus(id: string): Promise<Listing> {
  return fetch(`/api/admin/listings/${id}/openshell-session`).then((r) => parse<Listing>(r));
}

/** Tears down an openshell listing's sandbox session. */
export function stopOpenShellSession(id: string): Promise<Listing> {
  return fetch(`/api/admin/listings/${id}/openshell-session`, { method: "DELETE" }).then((r) =>
    parse<Listing>(r)
  );
}

export interface InteractiveEndpoint {
  url: string;
}

/** Mints a fresh terminal token/URL for a listing's running sandbox session. */
export function fetchListingTerminalEndpoint(id: string): Promise<InteractiveEndpoint> {
  return fetch(`/api/admin/listings/${id}/terminal-endpoint`).then((r) =>
    parse<InteractiveEndpoint>(r)
  );
}

export function fetchEngineSettings(): Promise<EngineSettings> {
  return fetch("/api/admin/engine-settings").then((r) =>
    parse<EngineSettings>(r)
  );
}

export function fetchPlatformStatus(): Promise<PlatformStatus> {
  return fetch("/api/admin/platform").then((r) => parse<PlatformStatus>(r));
}

/** Starts (or re-starts) the one-time "install the OpenShell gateway"
 * AAP job. Returns the updated PlatformSettings (holding
 * `openshellGatewayDeployment`), not the full PlatformStatus. */
export function deployGateway(): Promise<PlatformSettings> {
  return fetch("/api/admin/platform/gateway", { method: "POST" }).then((r) =>
    parse<PlatformSettings>(r)
  );
}

/** Polls the in-flight gateway install for progress; safe to call on an
 * interval. */
export function fetchGatewayStatus(): Promise<PlatformSettings> {
  return fetch("/api/admin/platform/gateway").then((r) => parse<PlatformSettings>(r));
}

/** Starts (or re-starts) the one-time "Create job templates" AAP
 * bootstrap. `settings` is saved server-side in the same request (no
 * separate "Save" step) before the bootstrap kicks off — mirrors
 * `testPlatformConnection()`'s save-as-a-side-effect convention. Returns
 * the updated PlatformSettings (holding `aapBootstrap`). */
export function createJobTemplates(settings: Partial<PlatformSettings>): Promise<PlatformSettings> {
  return fetch("/api/admin/platform/job-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  }).then((r) => parse<PlatformSettings>(r));
}

/** Polls the in-flight job template bootstrap for progress; safe to call
 * on an interval. */
export function fetchJobTemplateBootstrapStatus(): Promise<PlatformSettings> {
  return fetch("/api/admin/platform/job-templates").then((r) => parse<PlatformSettings>(r));
}

/** Registers an already-built-and-pushed image as an AAP Execution
 * Environment (see ansible/execution-environment/README.md for building
 * it) and auto-selects it. Returns the updated PlatformSettings. */
export function registerExecutionEnvironment(input: {
  name: string;
  image: string;
  credentialId?: number;
}): Promise<PlatformSettings> {
  return fetch("/api/admin/platform/execution-environments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => parse<PlatformSettings>(r));
}

/** Starts (or re-starts) the "Build from source" OpenShift build (Admin
 * -> Platform -> AAP Job Templates -> "+ Build from source"). `settings`
 * is saved server-side in the same request (no separate "Save" step),
 * same save-as-a-side-effect convention as createJobTemplates() —
 * otherwise a Git URL/branch typed into the draft but never saved via
 * "Create job templates" would silently be lost. Returns the updated
 * PlatformSettings (holding `eeBuild`). */
export function startEeImageBuild(input: {
  name: string;
  credentialId?: number;
  settings?: Partial<PlatformSettings>;
}): Promise<PlatformSettings> {
  return fetch("/api/admin/platform/execution-environment-build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => parse<PlatformSettings>(r));
}

/** Polls the in-flight build for progress; safe to call on an interval. */
export function fetchEeBuildStatus(): Promise<PlatformSettings> {
  return fetch("/api/admin/platform/execution-environment-build").then((r) => parse<PlatformSettings>(r));
}

/** Tail of the build's log, for the "View build log" section — lets an
 * admin see exactly why a build failed without leaving AgentStore. */
export function fetchEeBuildLog(): Promise<{ log: string }> {
  return fetch("/api/admin/platform/execution-environment-build/log").then((r) =>
    parse<{ log: string }>(r)
  );
}

/** Starts (or re-starts) the agent-runtime image's "Build from source"
 * OpenShift build (Admin -> Platform -> Agent Runtime). `settings` is
 * saved server-side in the same request, same save-as-a-side-effect
 * convention as startEeImageBuild(). Returns the updated
 * PlatformSettings (holding `agentRuntimeBuild`/`agentRuntimeImage`). */
export function startAgentRuntimeBuild(settings?: Partial<PlatformSettings>): Promise<PlatformSettings> {
  return fetch("/api/admin/platform/agent-runtime-build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  }).then((r) => parse<PlatformSettings>(r));
}

/** Polls the in-flight agent-runtime build for progress; safe to call
 * on an interval. */
export function fetchAgentRuntimeBuildStatus(): Promise<PlatformSettings> {
  return fetch("/api/admin/platform/agent-runtime-build").then((r) => parse<PlatformSettings>(r));
}

/** Tail of the agent-runtime build's log, for the "View build log"
 * section. */
export function fetchAgentRuntimeBuildLog(): Promise<{ log: string }> {
  return fetch("/api/admin/platform/agent-runtime-build/log").then((r) => parse<{ log: string }>(r));
}

export function updatePlatformSettings(
  patch: Partial<PlatformSettings>
): Promise<PlatformStatus> {
  return fetch("/api/admin/platform", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => parse<PlatformStatus>(r));
}

export function testPlatformConnection(
  target: "aap" | "openshift",
  settings: Partial<PlatformSettings>
): Promise<{
  settings: PlatformSettings;
  aap?: PlatformStatus["aap"];
  openshift?: PlatformStatus["openshift"];
}> {
  return fetch("/api/admin/platform/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, settings }),
  }).then((r) =>
    parse<{
      settings: PlatformSettings;
      aap?: PlatformStatus["aap"];
      openshift?: PlatformStatus["openshift"];
    }>(r)
  );
}

// --- Secrets ---

export function fetchSecrets(): Promise<SecretSummary[]> {
  return fetch("/api/admin/secrets").then((r) => parse<SecretSummary[]>(r));
}

export function setSecretValue(key: string, value: string): Promise<SecretSummary> {
  return fetch(`/api/admin/secrets/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  }).then((r) => parse<SecretSummary>(r));
}

export function clearSecretValue(key: string): Promise<SecretSummary> {
  return fetch(`/api/admin/secrets/${encodeURIComponent(key)}`, {
    method: "DELETE",
  }).then((r) => parse<SecretSummary>(r));
}

// --- Model providers ---

export function fetchProviders(): Promise<ProviderStatus[]> {
  return fetch("/api/admin/providers").then((r) => parse<ProviderStatus[]>(r));
}

export function upsertProviderConfig(config: ProviderConfig): Promise<ProviderStatus> {
  return fetch("/api/admin/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  }).then((r) => parse<ProviderStatus>(r));
}

export function deleteProviderConfig(id: string): Promise<void> {
  return fetch(`/api/admin/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then((r) => parse<{ ok: boolean }>(r)).then(() => undefined);
}

export function setProviderKeyValue(id: string, value: string): Promise<ProviderStatus> {
  return fetch(`/api/admin/providers/${encodeURIComponent(id)}/key`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  }).then((r) => parse<ProviderStatus>(r));
}

export function testProviderConnection(id: string): Promise<ProviderStatus> {
  return fetch(`/api/admin/providers/${encodeURIComponent(id)}/test`, {
    method: "POST",
  }).then((r) => parse<ProviderStatus>(r));
}

export function activateProviderConfig(id: string): Promise<ProviderStatus> {
  return fetch(`/api/admin/providers/${encodeURIComponent(id)}/activate`, {
    method: "POST",
  }).then((r) => parse<ProviderStatus>(r));
}

// --- MCP servers ---

export function fetchMcpServers(): Promise<McpServerStatus[]> {
  return fetch("/api/admin/mcp-servers").then((r) => parse<McpServerStatus[]>(r));
}

export function upsertMcpServerConfig(config: McpServerConfig): Promise<McpServerStatus> {
  return fetch("/api/admin/mcp-servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  }).then((r) => parse<McpServerStatus>(r));
}

export function deleteMcpServerConfig(id: string): Promise<void> {
  return fetch(`/api/admin/mcp-servers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then((r) => parse<{ ok: boolean }>(r)).then(() => undefined);
}

export function connectMcpServerConfig(id: string): Promise<McpServerStatus> {
  return fetch(`/api/admin/mcp-servers/${encodeURIComponent(id)}/connect`, {
    method: "POST",
  }).then((r) => parse<McpServerStatus>(r));
}

export function disconnectMcpServerConfig(id: string): Promise<McpServerStatus> {
  return fetch(`/api/admin/mcp-servers/${encodeURIComponent(id)}/connect`, {
    method: "DELETE",
  }).then((r) => parse<McpServerStatus>(r));
}

export function setMcpAuthTokenValue(id: string, value: string): Promise<McpServerStatus> {
  return fetch(`/api/admin/mcp-servers/${encodeURIComponent(id)}/auth-token`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  }).then((r) => parse<McpServerStatus>(r));
}

export function setMcpToolEnabledValue(
  id: string,
  tool: string,
  enabled: boolean
): Promise<McpServerStatus> {
  return fetch(
    `/api/admin/mcp-servers/${encodeURIComponent(id)}/tools/${encodeURIComponent(tool)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }
  ).then((r) => parse<McpServerStatus>(r));
}

// --- Skills ---

export function fetchSkills(): Promise<Skill[]> {
  return fetch("/api/admin/skills").then((r) => parse<Skill[]>(r));
}

export function upsertSkillConfig(skill: Skill): Promise<Skill> {
  return fetch("/api/admin/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(skill),
  }).then((r) => parse<Skill>(r));
}

export function deleteSkillConfig(id: string): Promise<void> {
  return fetch(`/api/admin/skills/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then((r) => parse<{ ok: boolean }>(r)).then(() => undefined);
}

export interface SkillImportResult {
  packs: string[];
  written: number;
  errors: { pack: string; error: string }[];
}

/** Live equivalent of `npm run import-redhat-skills` — pulls the given Red
 * Hat Agentic Skill Pack(s) (or every pack, if omitted) from GitHub. */
export function importRedHatSkills(packs?: string[]): Promise<SkillImportResult> {
  return fetch("/api/admin/skills/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packs }),
  }).then((r) => parse<SkillImportResult>(r));
}

export type {
  DepartmentId,
  EngineSettings,
  Listing,
  ListingCreateInput,
  ListingUpdate,
  McpServerConfig,
  McpServerStatus,
  ProviderConfig,
  ProviderStatus,
  SecretSummary,
  Skill,
  PlatformSettings,
  PlatformStatus,
};
