import type { OpenshiftJobSummary } from "@agentstore/shared";
import {
  isOpenshiftConfigured,
  openshiftApiUrl,
  openshiftNamespace,
  openshiftToken,
} from "./config";

async function ocpFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = openshiftApiUrl();
  const token = openshiftToken();
  if (!base || !token) {
    throw new Error("OpenShift API URL or token is not configured");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

export async function pingOpenshift(): Promise<{ ok: boolean; error?: string }> {
  if (!isOpenshiftConfigured()) {
    return { ok: false, error: "OpenShift API URL or token is missing" };
  }
  try {
    const ns = openshiftNamespace();
    const response = await ocpFetch(`/api/v1/namespaces/${ns}`);
    if (response.status === 404) return { ok: false, error: `Namespace ${ns} not found` };
    if (!response.ok) return { ok: false, error: `OpenShift API returned ${response.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface K8sJob {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
  };
  status?: {
    active?: number;
    succeeded?: number;
    failed?: number;
    completionTime?: string;
  };
}

export async function listAgentJobs(): Promise<OpenshiftJobSummary[]> {
  const ns = openshiftNamespace();
  const selector = encodeURIComponent("app.kubernetes.io/managed-by=agentstore");
  const response = await ocpFetch(
    `/apis/batch/v1/namespaces/${ns}/jobs?labelSelector=${selector}`
  );
  if (!response.ok) throw new Error(`OpenShift list jobs: HTTP ${response.status}`);
  const body = (await response.json()) as { items?: K8sJob[] };
  return (body.items ?? []).map((job) => ({
    name: job.metadata?.name ?? "",
    namespace: job.metadata?.namespace ?? ns,
    active: job.status?.active,
    succeeded: job.status?.succeeded,
    failed: job.status?.failed,
    completionTime: job.status?.completionTime,
    creationTimestamp: job.metadata?.creationTimestamp,
    taskId: job.metadata?.labels?.["agentstore/task-id"],
  }));
}

export async function getJob(name: string): Promise<K8sJob | null> {
  const ns = openshiftNamespace();
  const response = await ocpFetch(`/apis/batch/v1/namespaces/${ns}/jobs/${name}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`OpenShift get job ${name}: HTTP ${response.status}`);
  return (await response.json()) as K8sJob;
}

export async function deleteJob(name: string): Promise<void> {
  const ns = openshiftNamespace();
  const response = await ocpFetch(
    `/apis/batch/v1/namespaces/${ns}/jobs/${name}?propagationPolicy=Background`,
    { method: "DELETE" }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`OpenShift delete job ${name}: HTTP ${response.status}`);
  }
}

export async function readResultConfigMap(jobName: string): Promise<string | undefined> {
  const ns = openshiftNamespace();
  const response = await ocpFetch(`/api/v1/namespaces/${ns}/configmaps/${jobName}-result`);
  if (!response.ok) return undefined;
  const body = (await response.json()) as { data?: Record<string, string> };
  return body.data?.draft ?? body.data?.output;
}
