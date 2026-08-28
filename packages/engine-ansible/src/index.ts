import type {
  EngineAdapter,
  EngineHandle,
  EngineStatus,
  TaskSpec,
} from "@agentstore/shared";
import * as aap from "./aap";
import {
  aapDefaultJobTemplateId,
  aapJobUrl,
  isAapConfigured,
  isOpenshiftConfigured,
  openshiftJobConsoleUrl,
  openshiftNamespace,
} from "./config";
import * as ocp from "./openshift";

interface SimulatedSession {
  startedAt: number;
  terminated: boolean;
  jobName: string;
  namespace: string;
}

function sessions(): Map<string, SimulatedSession> {
  const g = globalThis as typeof globalThis & {
    __agentStoreAnsibleSessions?: Map<string, SimulatedSession>;
  };
  if (!g.__agentStoreAnsibleSessions) {
    g.__agentStoreAnsibleSessions = new Map();
  }
  return g.__agentStoreAnsibleSessions;
}

function shortId(taskId: string): string {
  return taskId.replace(/-/g, "").slice(0, 8);
}

function jobNameFor(taskId: string): string {
  return `agent-${shortId(taskId)}`;
}

function extraVars(spec: TaskSpec) {
  return {
    listing_id: spec.listingId,
    listing_name: spec.listingName,
    task_id: spec.taskId,
    goal: spec.target?.goal ?? "",
    success_criteria: spec.target?.successCriteria ?? "",
    namespace: openshiftNamespace(),
    job_name: jobNameFor(spec.taskId),
    mode: spec.mode,
  };
}

export function createAnsibleEngine(opts?: { forceSimulated?: () => boolean }): EngineAdapter {
  const forced = () => Boolean(opts?.forceSimulated?.());

  return {
    async provision(spec: TaskSpec): Promise<EngineHandle> {
      const name = jobNameFor(spec.taskId);
      const namespace = openshiftNamespace();
      const simulate = forced() || !isAapConfigured();

      if (simulate) {
        const sandboxId = `sim-aap-${shortId(spec.taskId)}`;
        sessions().set(sandboxId, {
          startedAt: Date.now(),
          terminated: false,
          jobName: name,
          namespace,
        });
        return {
          engineType: "ansible",
          sandboxId,
          backend: "simulated",
          aapJobId: sandboxId,
          openshiftJobName: name,
          namespace,
        };
      }

      const templateId = spec.aapJobTemplateId ?? aapDefaultJobTemplateId();
      if (!templateId) {
        throw new Error(
          "No AAP job template configured. Set a default on the Platform tab or bind one on this listing."
        );
      }
      const launched = await aap.launchJobTemplate(templateId, extraVars(spec));
      return {
        engineType: "ansible",
        sandboxId: String(launched.id),
        backend: "aap",
        aapJobId: String(launched.id),
        openshiftJobName: name,
        namespace,
      };
    },

    async getStatus(handle: EngineHandle, spec: TaskSpec): Promise<EngineStatus> {
      if (handle.backend === "simulated" || handle.sandboxId.startsWith("sim-aap-")) {
        return simulatedStatus(handle, spec);
      }
      return liveStatus(handle, spec);
    },

    async exposeInteractiveEndpoint() {
      return null;
    },

    async terminate(handle: EngineHandle): Promise<void> {
      if (handle.backend === "simulated" || handle.sandboxId.startsWith("sim-aap-")) {
        const session = sessions().get(handle.sandboxId);
        if (session) session.terminated = true;
        return;
      }
      if (handle.aapJobId) {
        await aap.cancelJob(handle.aapJobId).catch(() => undefined);
      }
      if (handle.openshiftJobName && isOpenshiftConfigured()) {
        await ocp.deleteJob(handle.openshiftJobName).catch(() => undefined);
      }
    },
  };
}

function simulatedStatus(handle: EngineHandle, spec: TaskSpec): EngineStatus {
  let session = sessions().get(handle.sandboxId);
  if (!session) {
    session = {
      startedAt: Date.now() - 5000,
      terminated: false,
      jobName: handle.openshiftJobName ?? jobNameFor(spec.taskId),
      namespace: handle.namespace ?? openshiftNamespace(),
    };
    sessions().set(handle.sandboxId, session);
  }
  const base = {
    backend: "simulated" as const,
    aapJobId: handle.aapJobId ?? handle.sandboxId,
    openshiftJobName: session.jobName,
    namespace: session.namespace,
  };
  if (session.terminated) return { phase: "Cancelled", ...base };
  const elapsed = Date.now() - session.startedAt;
  if (elapsed < 1200) {
    return { phase: "Provisioning", provisioningStep: "Launching Ansible job (simulated)", ...base };
  }
  if (elapsed < 2800) {
    return {
      phase: "Provisioning",
      provisioningStep: "Playbook creating OpenShift Job (simulated)",
      ...base,
    };
  }
  if (spec.mode === "work-with-me") {
    return { phase: "Running", provisioningStep: "Agent Job Running (simulated)", ...base };
  }
  if (elapsed < 4500) {
    return { phase: "Running", provisioningStep: "Agent pod Running (simulated)", ...base };
  }
  return { phase: "AwaitingApproval", provisioningStep: "Draft ready (simulated)", ...base };
}

async function liveStatus(handle: EngineHandle, spec: TaskSpec): Promise<EngineStatus> {
  const jobId = handle.aapJobId ?? handle.sandboxId;
  const jobName = handle.openshiftJobName ?? jobNameFor(spec.taskId);
  const namespace = handle.namespace ?? openshiftNamespace();
  const base = {
    backend: "aap" as const,
    aapJobId: String(jobId),
    aapJobUrl: aapJobUrl(jobId),
    openshiftJobName: jobName,
    openshiftConsoleUrl: openshiftJobConsoleUrl(jobName, namespace),
    namespace,
  };

  let aapStatus = "unknown";
  try {
    const job = await aap.getJob(jobId);
    aapStatus = job.status;
  } catch (err) {
    return {
      phase: "Failed",
      outputSummary: err instanceof Error ? err.message : String(err),
      ...base,
    };
  }

  if (["new", "pending", "waiting", "running"].includes(aapStatus)) {
    return { phase: "Provisioning", provisioningStep: `AAP job ${aapStatus}`, ...base };
  }
  if (["failed", "error"].includes(aapStatus)) {
    return { phase: "Failed", provisioningStep: `AAP job ${aapStatus}`, ...base };
  }
  if (aapStatus === "canceled") {
    return { phase: "Cancelled", ...base };
  }

  if (isOpenshiftConfigured()) {
    try {
      const k8sJob = await ocp.getJob(jobName);
      if (!k8sJob) {
        return { phase: "Provisioning", provisioningStep: "Waiting for OpenShift Job", ...base };
      }
      if ((k8sJob.status?.failed ?? 0) > 0) {
        return { phase: "Failed", provisioningStep: "OpenShift Job failed", ...base };
      }
      if ((k8sJob.status?.succeeded ?? 0) > 0) {
        const draft = await ocp.readResultConfigMap(jobName);
        return {
          phase: spec.mode === "do-this-for-me" ? "AwaitingApproval" : "Completed",
          outputSummary: draft,
          provisioningStep: "OpenShift Job succeeded",
          ...base,
        };
      }
      return { phase: "Running", provisioningStep: "OpenShift Job active", ...base };
    } catch (err) {
      return {
        phase: "Running",
        provisioningStep: `AAP succeeded; OpenShift poll failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        ...base,
      };
    }
  }

  if (spec.mode === "do-this-for-me") {
    return { phase: "AwaitingApproval", provisioningStep: "AAP job succeeded", ...base };
  }
  return { phase: "Running", provisioningStep: "AAP job succeeded", ...base };
}

export const ansibleEngine = createAnsibleEngine();

export { pingAap, listJobTemplates, listRecentJobs } from "./aap";
export { pingOpenshift, listAgentJobs } from "./openshift";
export {
  applyPlatformEnv,
  isAapConfigured,
  isOpenshiftConfigured,
  aapControllerUrl,
  aapConsoleUrl,
  aapDefaultJobTemplateId,
  openshiftApiUrl,
  openshiftNamespace,
  openshiftConsoleUrl,
} from "./config";
export {
  deleteGenericAgentDeployment,
  getGenericAgentDeployStatus,
  launchGenericAgentDeploy,
  type GenericAgentDeployInput,
  type GenericAgentDeployStatus,
} from "./genericAgentDeploy";
/** Exported so deployments.ts can derive a stable per-listing resource
 * name the same way this file's (private) jobNameFor() does for Tasks —
 * DNS-1123-safe (lowercase alphanumeric + "-", no leading/trailing "-"),
 * since it becomes a Deployment/Service/Route/Secret name. */
export function genericAgentDeploymentName(listingId: string): string {
  const slug = listingId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `agent-${slug || "listing"}`;
}
