export type DepartmentId =
  | "engineering"
  | "security"
  | "support"
  | "data"
  | "finance";

/** Which container/runtime a listing's agent actually runs as. "generic-chat"
 * is a small, pre-built chat container (apps/agent-runtime) configured
 * per-listing with a provider, MCP servers, and skills, deployed once via
 * AAP as a persistent Deployment+Route — the admin opens the resulting chat
 * link directly. "openshell" is a persistent Agent Sandbox Service session
 * (a real `opencode`-style CLI sandbox) — the admin opens a live terminal
 * against it directly. Both are deployed once per listing; neither is
 * provisioned per-launch. */
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

/** The OpenShell equivalent of `AgentDeployment` — state of the one-time
 * "create a persistent Agent Sandbox Service session for this listing"
 * admin action. Populated by openshellDeploy.ts. Unlike the old per-task
 * flow, this session is created once and reused for every "Open terminal"
 * click, instead of a fresh sandbox per launch. */
export interface OpenShellSessionState {
  status: AgentDeploymentStatus;
  sandboxId?: string;
  error?: string;
  updatedAt?: string;
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

export interface Listing {
  id: string;
  name: string;
  department: DepartmentId;
  /** Free-text sub-grouping within a department, admin-facing display only
   * (table subtitle, wizard review card) — not used for filtering/search
   * logic, so it's optional. */
  category?: string;
  description: string;
  riskTier: RiskTier;
  reviewStatus: ReviewStatus;
  /** What this agent costs to run — informational only; there is no
   * per-launch metering anymore. */
  pricing?: Pricing;
  /** Which OpenShell CLI agent (e.g. "opencode") this listing's sandbox
   * runs, when `runtime === "openshell"`. */
  openshellAgent?: string;
  /** Which runtime container this agent runs as. Defaults to "generic-chat"
   * when unset (older listings created before this field existed). */
  runtime?: AgentRuntime;
  /** Per-agent bindings configured by the admin (provider, tools, skills). */
  agentConfig?: AgentConfig;
  /** Set by deployments.ts for `runtime: "generic-chat"` listings once an
   * admin has run the one-time "Deploy to OpenShift" action. Not part of
   * the YAML source — persisted the same way `agentConfig` overrides are. */
  deployment?: AgentDeployment;
  /** Set by openshellDeploy.ts for `runtime: "openshell"` listings once an
   * admin has created the listing's persistent sandbox session. Same
   * persistence convention as `deployment` above. */
  openshellSession?: OpenShellSessionState;
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
 * drafts for it, which MCP tools it may call, and which skills are
 * attached. */
export interface AgentConfig {
  providerId?: string;
  mcpToolBindings?: { serverId: string; tool: string }[];
  skillIds?: string[];
  /** AAP job template to launch for this listing's `generic-chat` deploy.
   * Falls back to the Platform default. Unused for `openshell` listings. */
  aapJobTemplateId?: number;
  /** Repository to clone once into an `openshell` listing's sandbox at
   * deploy time. Unused for `generic-chat` listings. */
  gitUrl?: string;
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
  category?: string;
  description: string;
  riskTier: RiskTier;
  pricing?: Pricing;
  openshellAgent?: string;
  runtime?: AgentRuntime;
  agentConfig?: AgentConfig;
  /** If true, the new listing starts published; otherwise it starts as a draft. */
  publish?: boolean;
}

/** Model/credential intent resolved by the console (providers.ts's
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
 * progressive-disclosure system prompt. */
export interface GenericAgentRuntimeConfig {
  listingName: string;
  introLines: string[];
  skills: Skill[];
  mcpServers: OpenShellMcpServerConfig[];
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
    | "openshellSession"
  >
>;

export interface EngineSettings {
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

  // --- AAP Job Template bootstrap (Admin -> Platform -> "Create job
  // templates") -- inputs the admin supplies once; the *outputs* land on
  // aapJobTemplateId/openshellGatewayJobTemplateId above, same fields the
  // manual-entry flow already used. ---
  /** AAP Organization name to create/attach objects under. Looked up by
   * name, never created (avoids requiring elevated RBAC on the AAP
   * token) — must already exist, "Default" always does on a fresh AAP. */
  aapOrganizationName: string;
  /** Name for the AAP Project this bootstrap finds-or-creates, pointing
   * at this repo's `ansible/` directory. */
  aapProjectName: string;
  /** Git URL/branch AAP syncs the Project from — must contain
   * ansible/provision-generic-agent.yml and
   * ansible/provision-openshell-gateway.yml at its root. */
  aapProjectGitUrl: string;
  aapProjectGitBranch: string;
  /** AAP Credential id (Source Control kind) for a private repo. Empty
   * means public/unauthenticated clone. */
  aapProjectScmCredentialId: number | "";
  /** AAP Execution Environment id the two created Job Templates run
   * under — must already have the `kubernetes.core` collection (and the
   * `helm` CLI, for the collaborative/gateway template) installed. AAP
   * has no API to build EE images, so unlike everything else this
   * bootstrap automates, the admin must have already built/published one
   * and just picks it from a list here. */
  aapExecutionEnvironmentId: number | "";
  /** Progress/result of the one-time "Create job templates" admin
   * action, once ever started. */
  aapBootstrap?: AapBootstrapStatus;
  /** Progress/result of the "Build from source" admin action (Admin ->
   * Platform -> AAP Job Templates -> "+ Build from source"), once ever
   * started — builds the Execution Environment image inside the
   * OpenShift cluster itself (an OpenShift BuildConfig, triggered from
   * AgentStore) instead of requiring `ansible-builder`/`podman` locally.
   * See EeBuildStatus. */
  eeBuild?: EeBuildStatus;

  // --- Agent Runtime image (Admin -> Platform -> Agent Runtime) --------
  //
  // apps/agent-runtime is the persistent chat container
  // provision-generic-agent.yml deploys per generic-chat listing. Unlike
  // the AAP Execution Environment above, there's no "manual register"
  // step for AAP to do — the built image's reference is used directly
  // by the Deployment spec — so this is just "build" (below) plus the
  // resulting reference, no separate id/lookup concept.
  /** The agent-runtime image's pullable reference, used by every
   * generic-chat deploy in place of the `agent-runtime:dev` placeholder
   * default (packages/engine-ansible/src/config.ts's
   * agentRuntimeImage()) — set automatically once a "Build from source"
   * build completes, or pasted in manually if built/pushed elsewhere. */
  agentRuntimeImage?: string;
  /** Progress/result of the agent-runtime "Build from source" admin
   * action, once ever started — same OpenShift BuildConfig/Build
   * mechanism as EeBuildStatus, just building
   * apps/agent-runtime/Containerfile instead, and with no AAP-
   * registration step tacked on. */
  agentRuntimeBuild?: OcpImageBuildStatus;

  // --- Agent Sandbox Service install (Admin -> LLMs -> OpenShell) ------
  //
  // apps/agent-sandbox-service is AgentStore's own in-cluster microservice
  // (see OpenShellGatewayDeployment above for the separate, third-party
  // OpenShell gateway it talks to). Unlike that gateway, there's no public
  // image to reference — "Install Agent Sandbox Service" builds it from
  // source (same OpenShift BuildConfig mechanism as agentRuntimeBuild
  // above), then deploys deploy/openshift/agent-sandbox-service.yaml's
  // Deployment/Service/Route with that image, and auto-fills
  // openshellServiceUrl + the OPENSHELL_SERVICE_TOKEN secret from the
  // result — see AgentSandboxServiceInstallStatus below.
  /** Progress/result of the "Install Agent Sandbox Service" admin
   * action, once ever started. */
  agentSandboxServiceInstall?: AgentSandboxServiceInstallStatus;

  // --- AgentStore-on-OpenShift deploy (Admin -> Platform -> AgentStore) --
  /** Progress/result of the "Deploy AgentStore to OpenShift" admin action.
   * Same BuildConfig/Build mechanism as agentRuntimeBuild, plus a second
   * phase applying deploy/openshift/agentstore.yaml and waiting for the
   * Route. */
  agentstoreDeploy?: AgentStoreDeployStatus;

  // --- RHDH self-service portal (Admin -> Self-service Portal) -----------
  /** Progress/result of the RHDH operator install + instance provision. */
  rhdhDeploy?: RhdhDeployStatus;
}

/** Progress/result of the "Build from source" admin action — builds
 * `ansible/execution-environment/Containerfile` as an OpenShift
 * BuildConfig (source: the same `aapProjectGitUrl`/`aapProjectGitBranch`
 * already configured for the AAP Project above, since that repo also
 * contains this Containerfile), pushes the result to OpenShift's
 * internal image registry via an ImageStream, then registers the
 * resulting pullable image reference as an AAP Execution Environment —
 * the same `findOrCreateExecutionEnvironment()` the manual "Register a
 * new image" action already uses, so both paths converge on one AAP
 * object. Same two-phase start/poll convention as AapBootstrapStatus:
 * the Build itself can take a few minutes, so starting it and polling it
 * are separate calls. */
/** Single source of truth for the "View build log" section's tail
 * size — used by both engine-ansible's getEeImageBuildLog() and the
 * Admin UI's description text ("last N lines"), so the two can never
 * drift out of sync the way they did once already. */
export const EE_BUILD_LOG_TAIL_LINES = 1000;

/** Generic OpenShift image-build progress shape, shared by every
 * "Build from source" admin action — both the AAP Execution
 * Environment's EeBuildStatus (below) and the agent-runtime chat
 * container's build (PlatformSettings.agentRuntimeBuild) are driven by
 * the exact same OpenShift BuildConfig/Build primitives
 * (packages/engine-ansible/src/openshift.ts), just with a different
 * Containerfile/context, and (for the EE only) an extra AAP-
 * registration step tacked on. */
export interface OcpImageBuildStatus {
  status: AgentDeploymentStatus;
  phase?: string;
  /** Raw OpenShift Build phase ("New" | "Pending" | "Running" |
   * "Complete" | "Failed" | "Error" | "Cancelled"), refreshed every
   * poll — drives the "Build from source" mini-form's progress bar.
   * OpenShift doesn't expose a real completion percentage, so this is
   * the most granular signal available. */
  ocpPhase?: string;
  /** Stashed between start and finish — not shown in the UI. */
  buildName?: string;
  /** The built image's pullable reference (OpenShift's internal
   * registry, e.g. `image-registry.openshift-image-registry.svc:5000/
   * <namespace>/agentstore-ee@sha256:...`), once status is "running". */
  image?: string;
  error?: string;
  updatedAt?: string;
}

export interface EeBuildStatus extends OcpImageBuildStatus {
  /** Stashed between start and finish: the AAP Execution Environment
   * name/registry-credential this build's image gets registered under
   * once the OpenShift Build completes. */
  executionEnvironmentName?: string;
  registryCredentialId?: number;
  /** Mirrors PlatformSettings.aapExecutionEnvironmentId once registered. */
  executionEnvironmentId?: number;
}

/** Progress/result of "Install Agent Sandbox Service" (Admin -> LLMs ->
 * OpenShell) — the same OpenShift BuildConfig/Build mechanism as
 * OcpImageBuildStatus (building apps/agent-sandbox-service/Containerfile),
 * plus a second phase once the image is ready: applying
 * deploy/openshift/agent-sandbox-service.yaml's Deployment/Service/Route
 * with that image, finding-or-creating the agent-sandbox-service-token
 * Secret, and waiting for the Deployment to roll out. `phase` is
 * "building" during the first phase (mirrors OcpImageBuildStatus.phase)
 * or "waiting-for-rollout" during the second. */
export interface AgentSandboxServiceInstallStatus extends OcpImageBuildStatus {
  /** The Route's externally-reachable URL once applied — the same value
   * auto-saved onto PlatformSettings.openshellServiceUrl, so the OpenShell
   * tab's "Service configured" fields fill in without manual copy-pasting. */
  routeUrl?: string;
  /** Timestamp of the one automatic "rollout restart" nudge
   * refreshAgentSandboxServiceInstall() gives a stalled Deployment (e.g.
   * one whose ServiceAccount didn't exist yet on the first apply, but
   * does now) before giving up and surfacing the stall as a failure —
   * see that function's doc comment. Unset until the first nudge. */
  restartNudgedAt?: string;
}

/** Progress/result of "Deploy AgentStore to OpenShift" (Admin -> Platform ->
 * AgentStore on OpenShift) — same BuildConfig/Build mechanism as
 * OcpImageBuildStatus (building apps/web/Containerfile), plus a second
 * phase applying deploy/openshift/agentstore.yaml and waiting for the
 * Route. */
export interface AgentStoreDeployStatus extends OcpImageBuildStatus {
  routeUrl?: string;
}

/** Progress/result of the RHDH self-service portal install (Admin ->
 * Self-service Portal). Two independent sub-phases: operator install
 * (Subscription + OperatorGroup) and instance provision (ConfigMaps +
 * Secret + Backstage CR). */
export interface RhdhDeployStatus {
  operatorStatus: "not-installed" | "installing" | "installed" | "failed";
  instanceStatus: "not-deployed" | "deploying" | "running" | "failed";
  /** RHDH Route URL once the instance is running. */
  routeUrl?: string;
  error?: string;
  updatedAt?: string;
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

/** Minimal id/name pair for the AAP objects the Job Template bootstrap
 * needs the admin to pick (Execution Environment) or optionally pick
 * (Source Control credential, for a private Project repo). */
export interface AapNamedObject {
  id: number;
  name: string;
}

/** Progress/result of the one-time "Create job templates" admin action
 * (Admin -> Platform -> AAP Job Templates) — calls the AAP REST API
 * directly to create the Project/Inventory/Credential/Job Template
 * objects the two "deploy via AAP" flows
 * (genericAgentDeploy.ts/gatewayDeploy.ts) launch by id. Platform-scoped,
 * so it lives on PlatformSettings, same convention as
 * OpenShellGatewayDeployment. `phase` is a short human-readable label
 * ("syncing-project", "creating-templates", ...) the UI can show next to
 * a spinner while `status` is "running" — the underlying work spans two
 * HTTP round trips (start kicks off the Project SCM sync, refresh polls
 * it and finishes once sync succeeds) because a Project's initial sync
 * can take longer than one request should block for. */
export interface AapBootstrapStatus {
  status: AgentDeploymentStatus;
  phase?: string;
  /** Stashed between the start and finish calls — not shown in the UI. */
  projectId?: number;
  projectUpdateId?: number;
  /** Populated once status is "running"/"done": mirrors
   * PlatformSettings.aapJobTemplateId once the launch flow can use it. */
  autonomousJobTemplateId?: number;
  /** Mirrors PlatformSettings.openshellGatewayJobTemplateId. */
  collaborativeJobTemplateId?: number;
  /** Whether this run actually created the autonomous/collaborative Job
   * Template (a fresh AAP object) vs. finding one that already existed by
   * name and just verifying/patching it in place. Lets the "Create job
   * templates" UI say what actually happened instead of a generic
   * "ready" that reads the same either way. Undefined on older persisted
   * state from before this field existed. */
  autonomousCreated?: boolean;
  collaborativeCreated?: boolean;
  error?: string;
  updatedAt?: string;
}

export interface AapJobSummary {
  id: number;
  name: string;
  status: string;
  started?: string;
  finished?: string;
  url?: string;
}

/** A running generic-chat agent Deployment on OpenShift (see
 * listAgentDeployments() in packages/engine-ansible/src/openshift.ts).
 * Scoped to Deployments only — the OpenShell gateway (a Helm-installed
 * Deployment/StatefulSet in its own namespace) isn't included; see that
 * function's doc comment. */
export interface OpenshiftDeploymentSummary {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  creationTimestamp?: string;
  listingId?: string;
}

/** Live "is the Kubernetes SIG Agent Sandbox controller/CRDs installed on
 * this cluster" preflight check (see checkAgentSandboxController() in
 * packages/engine-ansible/src/openshift.ts) — the OpenShell Helm chart's
 * own preflight template refuses to install without it (neither
 * `agents.x-k8s.io/v1beta1` nor `v1alpha1` served). Re-checked on every
 * `GET /api/admin/platform`, so this is always fresh, never persisted. */
export interface AgentSandboxControllerStatus {
  installed: boolean;
  error?: string;
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
    /** For the Execution Environment `FormSelect` on the "Create job
     * templates" card — required, no default is sensible to guess. */
    executionEnvironments: AapNamedObject[];
    /** Source Control kind credentials only, for the optional SCM
     * credential `FormSelect` (private Project repos). */
    credentials: AapNamedObject[];
    /** For the Organization `FormSelect` — real options instead of a
     * free-text field, since organizations are only ever looked up by
     * name, never created. */
    organizations: AapNamedObject[];
    /** For the Project `FormSelect` — lets the admin reuse an existing
     * Project by name instead of retyping it from memory. */
    projects: AapNamedObject[];
    /** Container Registry (kind "registry") credentials, for the
     * optional "Register a new image" mini-form's private-registry
     * credential `FormSelect`. */
    registryCredentials: AapNamedObject[];
  };
  openshift: PlatformConnectionStatus & {
    deployments: OpenshiftDeploymentSummary[];
    /** Preflight for the OpenShell tab's "Install Agent Sandbox
     * controller" button — see AgentSandboxControllerStatus above. */
    agentSandboxController: AgentSandboxControllerStatus;
  };
  /** Agent Sandbox Service reachability (GET /health), independent of
   * whether any listing currently uses it. */
  openshellService: PlatformConnectionStatus;
}

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
      "Used to clone the repo bound to an OpenShell listing's Agent config (Repository URL) when its sandbox session is deployed. Forwarded to the Agent Sandbox Service, which performs the clone inside the sandbox — the console never clones anything itself.",
    usedBy: "engine-openshell adapter (forwarded for git clone)",
    group: "tooling",
  },
  {
    key: "GITHUB_PACKAGES_TOKEN",
    label: "GitHub Packages token (npm registry)",
    description:
      "GitHub personal access token with read:packages scope. Used at build time to install @nvidia/openshell-sdk from GitHub Packages (npm.pkg.github.com). Stored as a Kubernetes Secret and injected into the OpenShift BuildConfig.",
    usedBy: "Agent Sandbox Service build (Containerfile npm install)",
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
      "Bearer token used to watch and stop agent Jobs on the OpenShift cluster.",
    usedBy: "engine-ansible adapter / Platform portal",
    group: "platform",
  },
  {
    key: "AGENTSTORE_SERVICE_TOKEN",
    label: "RHDH service-to-service token",
    description:
      "Shared secret that Red Hat Developer Hub's proxy sends in the X-AgentStore-Token header for service-to-service authentication. When set, incoming requests bearing this token bypass the normal cookie-based admin check.",
    usedBy: "RHDH proxy → AgentStore API (catalog-sync, listings)",
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

export function departmentLabel(id: DepartmentId | "all"): string {
  return DEPARTMENTS.find((d) => d.id === id)?.name ?? id;
}
