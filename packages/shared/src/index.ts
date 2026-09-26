export type DepartmentId =
  | "engineering"
  | "security"
  | "support"
  | "data"
  | "finance";

export type EngineType = "self-hosted-sandbox" | "hosted-agent-api";

/** Which container/runtime a listing's agent actually runs as, independent of
 * `engineType`/`openshellAgent`. "generic-chat" is the new default: a small,
 * pre-built chat container (apps/agent-runtime) configured per-listing with
 * a provider, MCP servers, and skills, deployed once by AAP as a persistent
 * Deployment+Route. "openshell" is the existing, unchanged Engineering path
 * (Agent Sandbox Service + per-task sandbox), kept for coding agents. */
export type AgentRuntime = "generic-chat" | "openshell";

export type AgentDeploymentStatus = "not-deployed" | "deploying" | "running" | "failed";

/** State of the one-time "deploy this agent to OpenShift via AAP" action for
 * a `generic-chat` listing. Populated by deployments.ts, not part of the
 * YAML source — this is what turns into the persistent web link users open,
 * as opposed to Task/EngineHandle which model a single user's launch. */
export interface AgentDeployment {
  status: AgentDeploymentStatus;
  aapJobId?: string;
  aapJobUrl?: string;
  openshiftDeploymentName?: string;
  namespace?: string;
  /** The persistent chat URL, once status is "running". */
  routeUrl?: string;
  error?: string;
  updatedAt?: string;
}

export type AgentMode = "work-with-me" | "do-this-for-me";

/** Single source of truth for the UI-facing Autonomous/Collaborative split.
 * `AgentMode` is no longer independently configurable per listing — it's a
 * strict 1:1 function of `EngineType`, so the two can never drift apart:
 * `self-hosted-sandbox` (the OpenShell sandbox engine, e.g. `opencode`) is
 * always Collaborative/`work-with-me`; every other engine (the minimalist
 * Skills-Agent engine, whether delivered as a one-shot draft or a persistent
 * chat) is always Autonomous/`do-this-for-me`. See `modeLabel()` in
 * apps/web/src/lib/format.ts for the human-facing text. */
export function deriveAgentMode(engineType: EngineType): AgentMode {
  return engineType === "self-hosted-sandbox" ? "work-with-me" : "do-this-for-me";
}

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
  /** Computed by catalog.ts at load time via `deriveAgentMode(engineType)` —
   * not part of the YAML source, same pattern as `source` below. Never set
   * this directly; it always follows `engineType` 1:1. */
  mode: AgentMode;
  riskTier: RiskTier;
  reviewStatus: ReviewStatus;
  /** What this agent costs to run. Falls back to a mode-based default
   * estimate (see orchestrator.ts COST_BY_MODE) when unset. */
  pricing?: Pricing;
  /** Adapter-private. Only set on Engine 1 listings. */
  openshellAgent?: string;
  /** Which runtime container this agent runs as. Defaults to "generic-chat"
   * when unset (older listings created before this field existed). */
  runtime?: AgentRuntime;
  /** Per-agent bindings configured by the admin (provider, tools, skills, engine override). */
  agentConfig?: AgentConfig;
  /** Set by deployments.ts for `runtime: "generic-chat"` listings once an
   * admin has run the one-time "Deploy to OpenShift" action. Not part of
   * the YAML source — persisted the same way `agentConfig` overrides are. */
  deployment?: AgentDeployment;
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
 * number of agents. Loaded progressively (see packages/agent-core's
 * chatLoop): only `name`+`description` sit in the system prompt as a menu;
 * `instructions` are injected on demand when the model calls `load_skill`. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  /** Tool names (matched by `ModelTool.name`) this skill's SKILL.md declares
   * via its `allowed-tools` frontmatter. When set, those tools are only
   * visible to the model while this skill is active; tools not claimed by
   * any skill's `allowedTools` stay always-visible. Undefined/empty means
   * this skill doesn't scope tool visibility at all. */
  allowedTools?: string[];
  /** Red Hat agentic-plugins pack this skill was imported from (e.g.
   * "rh-sre"), for admin-side filtering. Unset for custom, hand-authored
   * skills. */
  pack?: string;
  /**
   * Set by skills.ts at load time based on which directory the skill was
   * loaded from (mirrors Listing.source): "built-in" skills ship in
   * catalog/skills/**, imported once by scripts/import-redhat-skills.ts,
   * and are read-only — attempting to edit/delete one is rejected.
   * "custom" skills are authored through the Admin Skills panel and are
   * freely editable. Not present in the JSON source itself.
   */
  source?: "built-in" | "custom";
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
  riskTier: RiskTier;
  pricing?: Pricing;
  openshellAgent?: string;
  runtime?: AgentRuntime;
  agentConfig?: AgentConfig;
  /** If true, the new listing starts published; otherwise it starts as a draft. */
  publish?: boolean;
}

export interface TaskTarget {
  goal: string;
  successCriteria?: string;
}

export type EngineBackend = "aap" | "simulated" | "openshell" | "generic-chat" | "fake";

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
    kind: "simulated" | "openshell" | "generic-chat";
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

/** Shape of the JSON file mounted at /etc/agent/config.json inside the
 * generic-chat runtime container (apps/agent-runtime) — the structured half
 * of the hybrid config-delivery split (flat scalars like provider kind/key
 * go in as env vars instead; see ansible/provision-generic-agent.yml).
 * `introLines` + `skills` are fed straight into packages/agent-core's
 * buildSystemPrompt()/chatLoop so the container computes the same
 * progressive-disclosure system prompt drafting.ts does. */
export interface GenericAgentRuntimeConfig {
  listingName: string;
  introLines: string[];
  skills: Skill[];
  mcpServers: OpenShellMcpServerConfig[];
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
  /** Resolved provider credentials for the Skills Agent's one-shot draft
   * shape (engine-ansible's extraVars()) — same resolution as
   * `openshellModel` above, just under an engine-agnostic name since
   * there's nothing OpenShell-specific about a one-shot Job's model. */
  providerConfig?: OpenShellModelConfig;
  /** Full Skill objects (with instructions) for the one-shot Job's mounted
   * config.json — same shape drafting.ts's fallback and the persistent-chat
   * shape already use, so the live AAP path gets real Skills too. */
  skills?: Skill[];
  /** Persona lines for the one-shot Job's mounted config.json — same
   * wording drafting.ts's introLinesFor() uses for the simulated/fallback
   * path, so the live AAP path frames the agent identically. */
  introLines?: string[];
}

export interface EngineAdapter {
  provision(spec: TaskSpec): Promise<EngineHandle>;
  getStatus(handle: EngineHandle, spec: TaskSpec): Promise<EngineStatus>;
  exposeInteractiveEndpoint(
    handle: EngineHandle
  ): Promise<{ kind: "simulated" | "openshell" | "generic-chat"; url?: string } | null>;
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
      kind: "simulated" | "openshell" | "generic-chat";
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
    | "runtime"
    | "deployment"
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
  /** Admin-supplied Helm chart reference for the OpenShell gateway itself —
   * a different thing from the Agent Sandbox Service above: this is
   * NVIDIA's actual sandboxing runtime the Service's `openshell` CLI talks
   * to. Defaults to the real published chart
   * (docs.nvidia.com/openshell/kubernetes/openshift), left editable for a
   * private mirror or pinned dev build. */
  openshellGatewayChartRef: string;
  /** Empty string means "whatever `helm upgrade --install` resolves as
   * latest for an OCI chart with no explicit --version". */
  openshellGatewayChartVersion: string;
  /** Distinct from `openshiftNamespace` above (that one's for AAP's own
   * agent Jobs/Deployments) — the gateway + its Agent Sandbox controller
   * CRDs conventionally live in their own namespace. */
  openshellGatewayNamespace: string;
  openshellGatewayWorkloadKind: GatewayWorkloadKind;
  /** AAP Job Template pointing at provision-openshell-gateway.yml. */
  openshellGatewayJobTemplateId: number | "";
  /** Progress/result of the one-time "install the gateway" admin action,
   * once ever started — see OpenShellGatewayDeployment below. */
  openshellGatewayDeployment?: OpenShellGatewayDeployment;
}

/** The OpenShell chart's workload kind for its main server: a
 * `statefulset` (default, SQLite-backed, single replica — what a demo/eval
 * cluster wants) or a `deployment` (external Postgres, for HA) — see
 * docs.nvidia.com/openshell/kubernetes/openshift. Readiness must be
 * checked differently for each. */
export type GatewayWorkloadKind = "statefulset" | "deployment";

/** Progress/result of the one-time "install the OpenShell gateway Helm
 * chart via AAP" admin action — same status/aapJobId/error/updatedAt
 * shape as AgentDeployment, but platform-scoped (one gateway per
 * cluster/namespace) rather than per-listing, so it lives on
 * PlatformSettings instead of a Listing. Populated by apps/web's
 * gateway.ts (mirrors deployments.ts). */
export interface OpenShellGatewayDeployment {
  status: AgentDeploymentStatus;
  aapJobId?: string;
  aapJobUrl?: string;
  releaseName?: string;
  namespace?: string;
  chartRef?: string;
  chartVersion?: string;
  workloadKind?: GatewayWorkloadKind;
  /** In-cluster URL (e.g. `http://openshell.openshell.svc:8443`) once
   * status is "running" — what the Agent Sandbox Service's non-interactive
   * `openshell gateway add --url ...` bootstrap step should target. Not
   * the same as `openshellServiceUrl` above, which is this repo's own
   * microservice's externally-reachable Route. */
  gatewayUrl?: string;
  error?: string;
  updatedAt?: string;
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

// --- Skills-used footer (Skills Agent one-shot draft shape) --------------

/** Marker both the live AAP path (apps/agent-runtime's runOnce.ts) and the
 * simulated/disconnected fallback (apps/web/src/server/drafting.ts) append
 * to a one-shot draft when at least one Skill got loaded mid-turn, so
 * TaskDetailPage.tsx can render "Skills used" as its own line instead of
 * leaving it buried in the draft text — the one-shot shape has no chat
 * transcript to show a loaded-skill chip in, unlike the persistent-chat
 * shape (see chatPage.ts). */
const SKILLS_USED_MARKER = "\n\n— Skills used: ";

export function appendSkillsFooter(text: string, skillIds: string[]): string {
  return skillIds.length > 0 ? `${text}${SKILLS_USED_MARKER}${skillIds.join(", ")}` : text;
}

/** Splits a draft produced by `appendSkillsFooter` back into its main text
 * and the loaded skill ids, if any. */
export function splitSkillsFooter(text: string): { draft: string; skillIds: string[] } {
  const idx = text.lastIndexOf(SKILLS_USED_MARKER);
  if (idx === -1) return { draft: text, skillIds: [] };
  const skillIds = text
    .slice(idx + SKILLS_USED_MARKER.length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { draft: text.slice(0, idx), skillIds };
}

export function departmentLabel(id: DepartmentId | "all"): string {
  return DEPARTMENTS.find((d) => d.id === id)?.name ?? id;
}
