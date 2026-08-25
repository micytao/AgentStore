import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEMO_USER,
  type AgentMode,
  type Listing,
  type OpenShellMcpServerConfig,
  type OpenShellModelConfig,
  type Role,
  type Task,
  type TaskPhase,
  type TaskTarget,
  type UsageSnapshot,
} from "@agentstore/shared";
import { getListing } from "./catalog";
import { adapterFor, isLiveEngine } from "./engines";
import { generateDraft, providerFor } from "./drafting";
import { apiKeyFor } from "./providers";
import { getMcpAuthToken, getMcpServer, listMcpServers } from "./mcp";
import { getSecret } from "./secrets";

const COST_BY_MODE: Record<AgentMode, number> = {
  "work-with-me": 2.4,
  "do-this-for-me": 0.8,
};

const TERMINAL_PHASES: TaskPhase[] = [
  "Completed",
  "Failed",
  "Cancelled",
];

type Store = {
  tasks: Map<string, Task>;
};

// File-backed durability (same pattern as providers.ts/mcp.ts/secrets.ts):
// task history now survives an app restart instead of vanishing with the
// in-memory globalThis Map.
function dataDir(): string {
  if (process.env.SECRETS_DATA_DIR) return process.env.SECRETS_DATA_DIR;
  const candidates = [
    path.resolve(process.cwd(), ".data"),
    path.resolve(process.cwd(), "../../.data"),
    path.resolve(__dirname, "../../../../.data"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

function tasksFilePath(): string {
  return path.join(dataDir(), "tasks.json");
}

function loadTasksFromDisk(): Map<string, Task> {
  const file = tasksFilePath();
  if (!fs.existsSync(file)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Task[];
    return new Map(raw.map((task) => [task.id, task]));
  } catch {
    return new Map();
  }
}

function persistTasks(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tasksFilePath(), JSON.stringify([...store().tasks.values()], null, 2));
}

function store(): Store {
  const g = globalThis as typeof globalThis & { __agentStore?: Store };
  if (!g.__agentStore) {
    g.__agentStore = { tasks: loadTasksFromDisk() };
  }
  return g.__agentStore;
}

/** Task IDs that already received a real (or fallback) draft, so generateDraft
 * runs at most once per task even though refresh() is polled repeatedly. */
function enrichedTaskIds(): Set<string> {
  const g = globalThis as typeof globalThis & { __agentStoreEnriched?: Set<string> };
  if (!g.__agentStoreEnriched) {
    g.__agentStoreEnriched = new Set();
  }
  return g.__agentStoreEnriched;
}

function now(): string {
  return new Date().toISOString();
}

/** Resolves the model credentials an OpenShell-hosted agent needs, as plain
 * data to forward to the Agent Sandbox Service — the console resolves
 * *which* provider (same logic drafting.ts uses for Autonomous drafts);
 * the service is the only thing that knows how to turn this into an
 * opencode.json / register an OpenShell provider. */
function openshellModelFor(listing: Listing): OpenShellModelConfig | undefined {
  const provider = providerFor(listing);
  if (!provider) return undefined;
  return {
    kind: provider.kind,
    defaultModel: provider.defaultModel,
    baseUrl: provider.baseUrl,
    apiKey: apiKeyFor(provider.id),
  };
}

/** Resolves the listing's enabled MCP servers down to the subset a
 * sandboxed agent can actually reach directly: remote transports only
 * (streamable-http/sse) with a URL. stdio servers spawn a process on the
 * console host and are not reachable from a cluster-hosted sandbox, so
 * they're silently dropped here rather than forwarded. */
function openshellMcpServersFor(listing: Listing): OpenShellMcpServerConfig[] {
  const bindings = listing.agentConfig?.mcpToolBindings;
  const serverIds = bindings && bindings.length > 0
    ? [...new Set(bindings.map((b) => b.serverId))]
    : listMcpServers()
        .filter((s) => s.enabled && s.connectionState === "connected")
        .map((s) => s.id);

  const out: OpenShellMcpServerConfig[] = [];
  for (const id of serverIds) {
    const server = getMcpServer(id);
    if (!server || !server.enabled) continue;
    if (server.transport !== "streamable-http" && server.transport !== "sse") continue;
    if (!server.url) continue;
    out.push({
      id: server.id,
      name: server.name,
      url: server.url,
      transport: server.transport,
      authToken: getMcpAuthToken(server.id),
    });
  }
  return out;
}

function specFrom(task: Task) {
  const listing = getListing(task.listingRef);
  const isOpenShell = Boolean(listing?.openshellAgent);
  return {
    taskId: task.id,
    listingId: task.listingRef,
    listingName: task.listingName,
    mode: task.mode,
    target: task.target,
    gitUrl: task.gitUrl,
    gitToken: isOpenShell && task.gitUrl ? getSecret("GIT_PAT") : undefined,
    openshellAgent: listing?.openshellAgent,
    openshellModel: isOpenShell && listing ? openshellModelFor(listing) : undefined,
    openshellMcpServers: isOpenShell && listing ? openshellMcpServersFor(listing) : undefined,
    aapJobTemplateId: listing?.agentConfig?.aapJobTemplateId,
  };
}

async function refresh(task: Task): Promise<Task> {
  if (TERMINAL_PHASES.includes(task.status.phase) || !task.status.engineRef) {
    return task;
  }
  const listing = getListing(task.listingRef);
  if (!listing) return task;
  const adapter = adapterFor(listing);
  const previousPhase = task.status.phase;
  const status = await adapter.getStatus(task.status.engineRef, specFrom(task));
  task.status.phase = status.phase;
  if (status.outputSummary) task.status.outputSummary = status.outputSummary;
  task.status.backend = status.backend;
  task.status.aapJobId = status.aapJobId;
  task.status.aapJobUrl = status.aapJobUrl;
  task.status.openshiftJobName = status.openshiftJobName;
  task.status.openshiftConsoleUrl = status.openshiftConsoleUrl;
  task.status.namespace = status.namespace;
  task.status.provisioningStep = status.provisioningStep;
  task.status.interactive = status.interactive;

  const justAwaitingApproval =
    status.phase === "AwaitingApproval" && previousPhase !== "AwaitingApproval";
  if (
    justAwaitingApproval &&
    task.mode === "do-this-for-me" &&
    !enrichedTaskIds().has(task.id)
  ) {
    enrichedTaskIds().add(task.id);
    if (!task.status.outputSummary) {
      task.status.outputSummary = await generateDraft(specFrom(task), listing);
    }
  }

  task.updatedAt = now();
  store().tasks.set(task.id, task);
  persistTasks();
  return task;
}

export async function listTasks(): Promise<Task[]> {
  const tasks = await Promise.all(
    [...store().tasks.values()].map((task) => refresh(task))
  );
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getTask(id: string): Promise<Task | undefined> {
  const task = store().tasks.get(id);
  if (!task) return undefined;
  return refresh(task);
}

export async function createTask(input: {
  listingId: string;
  mode: AgentMode;
  gitUrl?: string;
  target?: TaskTarget;
}): Promise<Task> {
  const listing = getListing(input.listingId);
  if (!listing) {
    throw new Error(`Unknown listing: ${input.listingId}`);
  }
  if (!listing.supportedModes.includes(input.mode)) {
    throw new Error(`Listing does not support ${input.mode}`);
  }

  const id = randomUUID();
  const createdAt = now();
  const task: Task = {
    id,
    listingRef: listing.id,
    listingName: listing.name,
    requestedBy: DEMO_USER,
    department: listing.department,
    mode: input.mode,
    target: input.target,
    gitUrl: input.gitUrl,
    status: {
      phase: "Pending",
      costEstimate: listing.pricing?.amount ?? COST_BY_MODE[input.mode],
      live: isLiveEngine(listing),
    },
    createdAt,
    updatedAt: createdAt,
  };
  store().tasks.set(id, task);
  persistTasks();

  try {
    const handle = await adapterFor(listing).provision(specFrom(task));
    task.status.engineRef = handle;
    task.status.phase = "Provisioning";
    task.status.backend = handle.backend;
    task.status.aapJobId = handle.aapJobId;
    task.status.openshiftJobName = handle.openshiftJobName;
    task.status.namespace = handle.namespace;
    task.status.live = handle.backend === "aap" || isLiveEngine(listing);
    task.updatedAt = now();
    store().tasks.set(id, task);
  } catch (err) {
    task.status.phase = "Failed";
    task.status.error = err instanceof Error ? err.message : String(err);
    task.updatedAt = now();
    store().tasks.set(id, task);
  }
  persistTasks();

  return task;
}

export async function cancelTask(id: string, role: Role): Promise<Task> {
  const task = await getTask(id);
  if (!task) throw new Error("Task not found");
  if (TERMINAL_PHASES.includes(task.status.phase)) {
    throw new Error("Task has already finished");
  }
  const listing = getListing(task.listingRef);
  if (listing && task.status.engineRef) {
    await adapterFor(listing).terminate(task.status.engineRef);
  }
  task.status.phase = "Cancelled";
  task.cancelledBy = role;
  task.updatedAt = now();
  store().tasks.set(id, task);
  persistTasks();
  return task;
}

/** Task IDs currently mid-decision, so two concurrent approve/reject calls
 * for the same task can't both pass the phase check before either write
 * lands (the check-and-add below is synchronous, before any await). */
function decidingTasks(): Set<string> {
  const g = globalThis as typeof globalThis & { __agentStoreDeciding?: Set<string> };
  if (!g.__agentStoreDeciding) {
    g.__agentStoreDeciding = new Set();
  }
  return g.__agentStoreDeciding;
}

export async function decideTask(
  id: string,
  decision: "approved" | "rejected",
  role: Role
): Promise<Task> {
  if (decidingTasks().has(id)) {
    throw new Error("Task decision already in progress");
  }
  decidingTasks().add(id);
  try {
    const task = await getTask(id);
    if (!task) throw new Error("Task not found");
    if (task.status.phase !== "AwaitingApproval") {
      throw new Error("Task is not waiting for approval");
    }
    task.approvalDecision = decision;
    task.decidedBy = role;
    task.status.phase = decision === "approved" ? "Completed" : "Cancelled";
    task.updatedAt = now();
    store().tasks.set(id, task);
    persistTasks();
    return task;
  } finally {
    decidingTasks().delete(id);
  }
}

/** Server-side only: mints a terminal URL/token for an interactive task.
 * Called from the terminal-endpoint API route rather than exposed as a
 * plain field on Task, so the Agent Sandbox Service's URL/token never sit
 * in a client-visible payload until a short-lived token is actually
 * minted for this specific request. */
export async function getInteractiveEndpoint(
  id: string
): Promise<{ kind: "simulated" | "openshell"; url?: string } | null> {
  const task = await getTask(id);
  if (!task || !task.status.engineRef) return null;
  const listing = getListing(task.listingRef);
  if (!listing) return null;
  return adapterFor(listing).exposeInteractiveEndpoint(task.status.engineRef);
}

export async function usage(): Promise<UsageSnapshot> {
  const tasks = await listTasks();
  const byDepartment: UsageSnapshot["byDepartment"] = {};
  let estimatedCost = 0;
  for (const task of tasks) {
    const cost = task.status.costEstimate ?? 0;
    estimatedCost += cost;
    const current = byDepartment[task.department] ?? {
      tasks: 0,
      estimatedCost: 0,
    };
    current.tasks += 1;
    current.estimatedCost += cost;
    byDepartment[task.department] = current;
  }
  return { totalTasks: tasks.length, byDepartment, estimatedCost };
}
