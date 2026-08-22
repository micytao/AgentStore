export type DepartmentId =
  | "engineering"
  | "security"
  | "support"
  | "data"
  | "finance";

export type EngineType = "self-hosted-sandbox" | "hosted-agent-api";

export type AgentMode = "work-with-me" | "do-this-for-me";

export type RiskTier = "low" | "medium" | "high";

export type ReviewStatus = "draft" | "in-review" | "published" | "deprecated";

export type TaskPhase =
  | "Pending"
  | "Provisioning"
  | "Running"
  | "AwaitingApproval"
  | "Completed"
  | "Failed"
  | "Cancelled";

export interface Listing {
  id: string;
  name: string;
  department: DepartmentId;
  category: string;
  description: string;
  icon: string;
  engineType: EngineType;
  supportedModes: AgentMode[];
  riskTier: RiskTier;
  reviewStatus: ReviewStatus;
  comingSoon?: boolean;
  /** Adapter-private. Only set on Engine 1 listings. */
  openshellAgent?: string;
}

export interface TaskTarget {
  goal: string;
  successCriteria?: string;
}

export interface EngineHandle {
  engineType: EngineType | "fake";
  sandboxId: string;
}

export interface EngineStatus {
  phase: TaskPhase;
  outputSummary?: string;
  interactive?: {
    kind: "simulated" | "openshell";
    attachHint?: string;
  };
}

export interface TaskSpec {
  taskId: string;
  listingId: string;
  listingName: string;
  mode: AgentMode;
  target?: TaskTarget;
  gitUrl?: string;
  openshellAgent?: string;
}

export interface EngineAdapter {
  provision(spec: TaskSpec): Promise<EngineHandle>;
  getStatus(handle: EngineHandle, spec: TaskSpec): Promise<EngineStatus>;
  exposeInteractiveEndpoint(
    handle: EngineHandle
  ): Promise<{ kind: "simulated" | "openshell"; url?: string } | null>;
  terminate(handle: EngineHandle): Promise<void>;
}

export interface Task {
  id: string;
  listingRef: string;
  listingName: string;
  requestedBy: string;
  department: DepartmentId;
  mode: AgentMode;
  target?: TaskTarget;
  gitUrl?: string;
  status: {
    phase: TaskPhase;
    engineRef?: EngineHandle;
    outputSummary?: string;
    costEstimate?: number;
    error?: string;
    live?: boolean;
  };
  approvalDecision?: "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export interface UsageSnapshot {
  totalTasks: number;
  byDepartment: Partial<
    Record<DepartmentId, { tasks: number; estimatedCost: number }>
  >;
  estimatedCost: number;
}

export type ListingUpdate = Partial<
  Pick<Listing, "name" | "description" | "riskTier" | "reviewStatus" | "comingSoon">
>;

export interface EngineSettings {
  /** When true, all tasks run on the FakeEngine even if an OpenShell gateway is configured. */
  forceSimulated: boolean;
  /** Whether OPENSHELL_GATEWAY_URL is set in this environment. Read-only. */
  gatewayConfigured: boolean;
}

export type Role = "user" | "admin";

// --- Secrets vault -----------------------------------------------------

export interface SecretSlot {
  key: string;
  label: string;
  description: string;
  usedBy: string;
}

export interface SecretSummary extends SecretSlot {
  hasValue: boolean;
  preview?: string;
  updatedAt?: string;
  source: "vault" | "env" | "none";
}

export const SECRET_SLOTS: SecretSlot[] = [
  {
    key: "OPENSHELL_GATEWAY_TOKEN",
    label: "OpenShell gateway token",
    description:
      "Auth token forwarded to the openshell CLI when provisioning sandboxes.",
    usedBy: "engine-openshell adapter",
  },
  {
    key: "GIT_PAT",
    label: "Git personal access token",
    description:
      "Used to clone the repo when a Collaborative task provides a git URL.",
    usedBy: "engine-openshell adapter (git clone)",
  },
];

// --- Model providers -----------------------------------------------------

export type ProviderKind = "anthropic" | "openai" | "openai-compatible" | "gemini";

export const PROVIDER_KINDS: { id: ProviderKind; label: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI" },
  { id: "openai-compatible", label: "OpenAI-compatible endpoint" },
  { id: "gemini", label: "Google Gemini" },
];

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  defaultModel?: string;
  active?: boolean;
}

export interface ProviderStatus extends ProviderConfig {
  hasKey: boolean;
  keyPreview?: string;
  models?: string[];
  lastChecked?: string;
  lastError?: string;
}

export interface ModelMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

export interface ModelTool {
  serverId: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ModelToolCall {
  serverId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ModelResponse {
  text?: string;
  toolCalls?: ModelToolCall[];
}

// --- MCP servers -----------------------------------------------------

export type McpTransport = "stdio" | "streamable-http" | "sse";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  enabled: boolean;
}

export interface McpServerStatus extends McpServerConfig {
  connectionState: "connected" | "error" | "disconnected";
  lastError?: string;
  tools: McpToolInfo[];
  /** Whether a bearer auth token is stored in the vault for this server (streamable-http/sse only). */
  hasAuthToken: boolean;
}

export const DEPARTMENTS: { id: DepartmentId | "all"; name: string }[] = [
  { id: "all", name: "All departments" },
  { id: "engineering", name: "Engineering" },
  { id: "security", name: "Security & Compliance" },
  { id: "support", name: "Customer Support" },
  { id: "data", name: "Data & Analytics" },
  { id: "finance", name: "Finance & HR" },
];

export const DEMO_USER = "demo-user";

export function departmentLabel(id: DepartmentId | "all"): string {
  return DEPARTMENTS.find((d) => d.id === id)?.name ?? id;
}
