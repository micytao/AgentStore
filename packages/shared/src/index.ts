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

/** How an agent's price is metered: a flat fee per task run (Autonomous
 * listings) or an hourly rate for a live session (Collaborative listings). */
export type PricingUnit = "per-task" | "per-hour";

export interface Pricing {
  unit: PricingUnit;
  /** USD. */
  amount: number;
}

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
  /** What this agent costs to run. Falls back to a mode-based default
   * estimate (see orchestrator.ts COST_BY_MODE) when unset. */
  pricing?: Pricing;
  /** Adapter-private. Only set on Engine 1 listings. */
  openshellAgent?: string;
  /** Per-agent bindings configured by the admin (provider, tools, skills, engine override). */
  agentConfig?: AgentConfig;
  /**
   * Set by catalog.ts at load time based on which directory the listing was
   * loaded from; not present in the YAML source itself. "custom" listings
   * were created through the Admin onboarding wizard and can be edited or
   * retired freely; "built-in" listings ship in catalog/listings and can
   * only have the fields in ListingUpdate overridden.
   */
  source?: "built-in" | "custom";
}

/** Per-agent configuration an admin binds to a listing: which model provider
 * drafts for it, which MCP tools it may call, which skills are attached, and
 * whether it should force simulated/live execution regardless of the global
 * engine setting. */
export interface AgentConfig {
  providerId?: string;
  mcpToolBindings?: { serverId: string; tool: string }[];
  skillIds?: string[];
  engineOverride?: "auto" | "simulated" | "live";
  /** AAP job template to launch for this listing. Falls back to the Platform default. */
  aapJobTemplateId?: number;
}

/** A reusable instruction bundle an admin can author once and attach to any
 * number of agents; its `instructions` are merged into the agent's system
 * prompt when drafting. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

/** Full input for the Admin onboarding wizard (creating a brand-new agent),
 * as opposed to ListingUpdate which only patches a few fields on an
 * existing one. */
export interface ListingCreateInput {
  name: string;
  department: DepartmentId;
  category: string;
  description: string;
  icon: string;
  engineType: EngineType;
  supportedModes: AgentMode[];
  riskTier: RiskTier;
  pricing?: Pricing;
  openshellAgent?: string;
  agentConfig?: AgentConfig;
  /** If true, the new listing starts published; otherwise it starts as a draft. */
  publish?: boolean;
}

export interface TaskTarget {
  goal: string;
  successCriteria?: string;
}

export type EngineBackend = "aap" | "simulated" | "openshell" | "fake";

export interface EngineHandle {
  engineType: EngineType | "fake" | "ansible";
  sandboxId: string;
  backend?: EngineBackend;
  aapJobId?: string;
  openshiftJobName?: string;
  namespace?: string;
}

export interface EngineStatus {
  phase: TaskPhase;
  outputSummary?: string;
  interactive?: {
    kind: "simulated" | "openshell";
    attachHint?: string;
  };
  backend?: EngineBackend;
  aapJobId?: string;
  aapJobUrl?: string;
  openshiftJobName?: string;
  openshiftConsoleUrl?: string;
  namespace?: string;
  provisioningStep?: string;
}

/** Model/credential intent resolved by the console (drafting.ts's
 * providerFor()) and forwarded, as plain data, to the Agent Sandbox
 * Service's `POST /sessions` — the service is the only thing that knows
 * how to turn this into an agent-specific config file (e.g. opencode.json). */
export interface OpenShellModelConfig {
  kind: ProviderKind;
  defaultModel?: string;
  /** Only meaningful for openai-compatible/gemini; must already be
   * reachable from inside the OpenShift cluster (see the topology caveat
   * in the plan — no localhost rewriting happens anywhere in this path). */
  baseUrl?: string;
  apiKey?: string;
}

/** A resolved MCP server the console already knows is enabled for this
 * listing (mcp.ts's listEnabledToolsFor()), reduced to what the sandboxed
 * agent itself needs to connect directly — only remote transports
 * (streamable-http/sse) are usable here; stdio servers run as a local
 * process on the console host and are not reachable from a cluster-hosted
 * sandbox, so they are filtered out before this is populated. */
export interface OpenShellMcpServerConfig {
  id: string;
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  authToken?: string;
}

export interface TaskSpec {
  taskId: string;
  listingId: string;
  listingName: string;
  mode: AgentMode;
  target?: TaskTarget;
  gitUrl?: string;
  /** GIT_PAT from the vault, forwarded so the Agent Sandbox Service can
   * clone inside the sandbox — the console never clones anything itself. */
  gitToken?: string;
  openshellAgent?: string;
  openshellModel?: OpenShellModelConfig;
  openshellMcpServers?: OpenShellMcpServerConfig[];
  aapJobTemplateId?: number;
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
    backend?: EngineBackend;
    aapJobId?: string;
    aapJobUrl?: string;
    openshiftJobName?: string;
    openshiftConsoleUrl?: string;
    namespace?: string;
    provisioningStep?: string;
    /** Set from EngineStatus.interactive by orchestrator.ts's refresh();
     * tells the task page which terminal component to render. */
    interactive?: {
      kind: "simulated" | "openshell";
    };
  };
  approvalDecision?: "approved" | "rejected";
  decidedBy?: Role;
  cancelledBy?: Role;
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
  Pick<
    Listing,
    | "name"
    | "description"
    | "riskTier"
    | "reviewStatus"
    | "pricing"
    | "agentConfig"
  >
>;

export interface EngineSettings {
  /** When true, all tasks run simulated even if AAP or OpenShell is configured. */
  forceSimulated: boolean;
  /** Whether the Agent Sandbox Service URL + token are configured. Read-only. */
  openshellServiceConfigured: boolean;
  /** Whether an AAP controller URL and token are configured. Read-only. */
  aapConfigured: boolean;
  /** Whether an OpenShift API URL and token are configured. Read-only. */
  openshiftConfigured: boolean;
}

export interface PlatformSettings {
  aapControllerUrl: string;
  aapJobTemplateId: number | "";
  aapConsoleUrl: string;
  /** Skip TLS certificate verification for the AAP controller — needed for
   * dev/workshop AAP instances behind a self-signed cert. Never enable this
   * against a real production controller. */
  aapInsecureTls: boolean;
  openshiftApiUrl: string;
  openshiftNamespace: string;
  openshiftConsoleUrl: string;
  /** Skip TLS certificate verification for the OpenShift API server — the
   * kube-apiserver's own cert (api.<cluster>:6443) is commonly self-signed
   * even when the cluster's Route/console wildcard cert is real (e.g.
   * Let's Encrypt), which is exactly the case on most workshop clusters. */
  openshiftInsecureTls: boolean;
  /** Agent Sandbox Service's externally-reachable Route base URL — see
   * packages/engine-openshell. Token lives in the vault (OPENSHELL_SERVICE_TOKEN). */
  openshellServiceUrl: string;
}

export interface AapJobTemplate {
  id: number;
  name: string;
}

export interface AapJobSummary {
  id: number;
  name: string;
  status: string;
  started?: string;
  finished?: string;
  url?: string;
}

export interface OpenshiftJobSummary {
  name: string;
  namespace: string;
  active?: number;
  succeeded?: number;
  failed?: number;
  completionTime?: string;
  creationTimestamp?: string;
  taskId?: string;
}

export interface PlatformConnectionStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
}

export interface PlatformStatus {
  settings: PlatformSettings;
  aap: PlatformConnectionStatus & {
    jobTemplates: AapJobTemplate[];
    recentJobs: AapJobSummary[];
  };
  openshift: PlatformConnectionStatus & {
    jobs: OpenshiftJobSummary[];
  };
  /** Agent Sandbox Service reachability (GET /health), independent of
   * whether any listing currently uses it. */
  openshellService: PlatformConnectionStatus;
}

export type Role = "user" | "admin";

// --- Secrets vault -----------------------------------------------------

export interface SecretSlot {
  key: string;
  label: string;
  description: string;
  usedBy: string;
  /** Which admin tab surfaces this slot: Platform (AAP/OpenShift) or LLMs (OpenShell/Git tooling). */
  group: "platform" | "tooling";
}

export interface SecretSummary extends SecretSlot {
  hasValue: boolean;
  preview?: string;
  updatedAt?: string;
  source: "vault" | "env" | "none";
}

export const SECRET_SLOTS: SecretSlot[] = [
  {
    key: "OPENSHELL_SERVICE_TOKEN",
    label: "Agent Sandbox Service token",
    description:
      "Bearer token the console uses to call the Agent Sandbox Service's REST API (create/get/delete session, mint terminal tokens). Separate from that service's own openshell gateway credentials, which it manages itself.",
    usedBy: "engine-openshell adapter (REST client)",
    group: "tooling",
  },
  {
    key: "GIT_PAT",
    label: "Git personal access token",
    description:
      "Used to clone the repo when a Collaborative task provides a git URL. Forwarded to the Agent Sandbox Service, which performs the clone inside the sandbox — the console never clones anything itself.",
    usedBy: "engine-openshell adapter (forwarded for git clone)",
    group: "tooling",
  },
  {
    key: "AAP_TOKEN",
    label: "AAP controller token",
    description:
      "OAuth2 or personal access token for the Ansible Automation Platform controller API.",
    usedBy: "engine-ansible adapter / Platform portal",
    group: "platform",
  },
  {
    key: "OPENSHIFT_TOKEN",
    label: "OpenShift API token",
    description:
      "Bearer token used to watch and stop agent Jobs on the prod OpenShift cluster.",
    usedBy: "engine-ansible adapter / Platform portal",
    group: "platform",
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
  { id: "support", name: "Customer Support" },
  { id: "finance", name: "Finance & HR" },
  { id: "data", name: "Data & Analytics" },
  { id: "security", name: "Security & Compliance" },
  { id: "engineering", name: "Engineering" },
];

export const DEMO_USER = "Demo";

export function departmentLabel(id: DepartmentId | "all"): string {
  return DEPARTMENTS.find((d) => d.id === id)?.name ?? id;
}
