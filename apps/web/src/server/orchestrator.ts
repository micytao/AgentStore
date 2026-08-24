import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEMO_USER,
  type AgentMode,
  type Task,
  type TaskPhase,
  type TaskTarget,
  type UsageSnapshot,
} from "@agentstore/shared";
import { getListing } from "./catalog";
import { adapterFor, isLiveEngine } from "./engines";
import { generateDraft } from "./drafting";

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

function specFrom(task: Task) {
  const listing = getListing(task.listingRef);
  return {
    taskId: task.id,
    listingId: task.listingRef,
    listingName: task.listingName,
    mode: task.mode,
    target: task.target,
    gitUrl: task.gitUrl,
    openshellAgent: listing?.openshellAgent,
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

export async function cancelTask(id: string): Promise<Task> {
  const task = await getTask(id);
  if (!task) throw new Error("Task not found");
  const listing = getListing(task.listingRef);
  if (listing && task.status.engineRef) {
    await adapterFor(listing).terminate(task.status.engineRef);
  }
  task.status.phase = "Cancelled";
  task.updatedAt = now();
  store().tasks.set(id, task);
  persistTasks();
  return task;
}

export async function decideTask(
  id: string,
  decision: "approved" | "rejected"
): Promise<Task> {
  const task = await getTask(id);
  if (!task) throw new Error("Task not found");
  if (task.status.phase !== "AwaitingApproval") {
    throw new Error("Task is not waiting for approval");
  }
  task.approvalDecision = decision;
  task.status.phase = decision === "approved" ? "Completed" : "Cancelled";
  task.updatedAt = now();
  store().tasks.set(id, task);
  persistTasks();
  return task;
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
