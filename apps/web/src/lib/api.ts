import type {
  AgentMode,
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
  Task,
  UsageSnapshot,
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

export function fetchListing(id: string): Promise<Listing> {
  return fetch(`/api/listings/${id}`).then((r) => parse<Listing>(r));
}

export function fetchTasks(): Promise<Task[]> {
  return fetch("/api/tasks").then((r) => parse<Task[]>(r));
}

export function fetchTask(id: string): Promise<Task> {
  return fetch(`/api/tasks/${id}`).then((r) => parse<Task>(r));
}

export function createTask(input: {
  listingId: string;
  mode: AgentMode;
  gitUrl?: string;
  target?: { goal: string; successCriteria?: string };
}): Promise<Task> {
  return fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => parse<Task>(r));
}

export function cancelTask(id: string): Promise<Task> {
  return fetch(`/api/tasks/${id}/cancel`, { method: "POST" }).then((r) =>
    parse<Task>(r)
  );
}

export function approveTask(id: string): Promise<Task> {
  return fetch(`/api/tasks/${id}/approve`, { method: "POST" }).then((r) =>
    parse<Task>(r)
  );
}

export function rejectTask(id: string): Promise<Task> {
  return fetch(`/api/tasks/${id}/reject`, { method: "POST" }).then((r) =>
    parse<Task>(r)
  );
}

export function fetchUsage(): Promise<UsageSnapshot> {
  return fetch("/api/usage").then((r) => parse<UsageSnapshot>(r));
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

export function deleteListingAdmin(id: string): Promise<void> {
  return fetch(`/api/admin/listings/${id}`, { method: "DELETE" })
    .then((r) => parse<{ ok: boolean }>(r))
    .then(() => undefined);
}

export function fetchEngineSettings(): Promise<EngineSettings> {
  return fetch("/api/admin/engine-settings").then((r) =>
    parse<EngineSettings>(r)
  );
}

export function fetchPlatformStatus(): Promise<PlatformStatus> {
  return fetch("/api/admin/platform").then((r) => parse<PlatformStatus>(r));
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

export function updateEngineSettings(
  patch: Partial<EngineSettings>
): Promise<EngineSettings> {
  return fetch("/api/admin/engine-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => parse<EngineSettings>(r));
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
  Task,
  UsageSnapshot,
  PlatformSettings,
  PlatformStatus,
};
