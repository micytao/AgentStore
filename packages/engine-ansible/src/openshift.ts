import type { OpenshiftJobSummary } from "@agentstore/shared";
import {
  isOpenshiftConfigured,
  openshiftApiUrl,
  openshiftInsecureTls,
  openshiftNamespace,
  openshiftToken,
} from "./config";
import { dispatcherFor } from "./tls";

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
  const dispatcher = dispatcherFor(openshiftInsecureTls());
  return fetch(`${base}${path}`, { ...init, headers, ...(dispatcher ? { dispatcher } : {}) } as RequestInit);
}

export async function pingOpenshift(): Promise<{ ok: boolean; error?: string }> {
  if (!isOpenshiftConfigured()) {
    return { ok: false, error: "OpenShift API URL or token is missing" };
  }
  const base = openshiftApiUrl();
  if (/console-openshift-console/.test(base)) {
    return {
      ok: false,
      error:
        `"${base}" looks like the web console URL, not the API server. Use the API server URL instead ` +
        `(usually https://api.<cluster-domain>:6443 — drop "console-openshift-console." and "apps.", add ":6443").`,
    };
  }
  try {
    const ns = openshiftNamespace();
    const response = await ocpFetch(`/api/v1/namespaces/${ns}`);
    if (response.status === 404) return { ok: false, error: `Namespace ${ns} not found` };
    if (!response.ok) return { ok: false, error: `OpenShift API returned ${response.status}` };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
    if (/self.signed|self signed|certificate/i.test(`${message} ${cause}`)) {
      return {
        ok: false,
        error:
          "TLS certificate rejected — the kube-apiserver's cert is self-signed on many dev/workshop clusters. " +
          "Check \"Allow self-signed certificate\" below if you trust this cluster.",
      };
    }
    return { ok: false, error: cause ? `${message}: ${cause}` : message };
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

/** Read-back for provision-generic-agent.yml's deploy-once flow — same
 * pattern as readResultConfigMap(), just against a `<deployment_name>
 * -deploy-result` ConfigMap holding the Route host instead of a draft. */
export async function readDeploymentResult(
  deploymentName: string
): Promise<{ status?: string; routeHost?: string } | undefined> {
  const ns = openshiftNamespace();
  const response = await ocpFetch(`/api/v1/namespaces/${ns}/configmaps/${deploymentName}-deploy-result`);
  if (!response.ok) return undefined;
  const body = (await response.json()) as { data?: Record<string, string> };
  return { status: body.data?.status, routeHost: body.data?.routeHost };
}

/** Best-effort teardown of everything provision-generic-agent.yml creates
 * for one listing, used when an admin re-deploys or removes a generic-chat
 * agent. Each resource is deleted independently so a 404 on one (already
 * gone) doesn't block the others. */
export async function deleteGenericAgentDeployment(deploymentName: string): Promise<void> {
  const ns = openshiftNamespace();
  const targets = [
    { path: `/apis/apps/v1/namespaces/${ns}/deployments/${deploymentName}` },
    { path: `/api/v1/namespaces/${ns}/services/${deploymentName}` },
    { path: `/apis/route.openshift.io/v1/namespaces/${ns}/routes/${deploymentName}` },
    { path: `/api/v1/namespaces/${ns}/secrets/${deploymentName}-config` },
    { path: `/api/v1/namespaces/${ns}/configmaps/${deploymentName}-deploy-result` },
  ];
  await Promise.all(
    targets.map(async ({ path }) => {
      try {
        const response = await ocpFetch(path, { method: "DELETE" });
        if (!response.ok && response.status !== 404) {
          console.warn(`[engine-ansible] delete ${path} returned HTTP ${response.status}`);
        }
      } catch (err) {
        console.warn(`[engine-ansible] delete ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );
}
