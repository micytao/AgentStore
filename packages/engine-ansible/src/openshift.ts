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

/** Read-back for provision-openshell-gateway.yml — same ConfigMap
 * read-back pattern as readDeploymentResult(), just against a
 * `<release_name>-gateway-result` ConfigMap in the *admin-supplied*
 * gateway namespace (not the fixed OPENSHIFT_NAMESPACE every other
 * function here uses), since the gateway conventionally lives in its own
 * namespace, separate from AAP's agent Jobs/Deployments. */
export async function readGatewayDeployResult(
  releaseName: string,
  namespace: string
): Promise<{ status?: string; gatewayUrl?: string; error?: string } | undefined> {
  const response = await ocpFetch(`/api/v1/namespaces/${namespace}/configmaps/${releaseName}-gateway-result`);
  if (!response.ok) return undefined;
  const body = (await response.json()) as { data?: Record<string, string> };
  return { status: body.data?.status, gatewayUrl: body.data?.gatewayUrl, error: body.data?.error };
}

// --- Execution Environment build (OpenShift BuildConfig) ---------------
//
// The "Build from source" admin action's low-level OpenShift calls — see
// eeBuild.ts one level up for the orchestration (find-or-create the
// ImageStream+BuildConfig, start a Build, poll it, read back the built
// image's pullable reference) that calls these in order. Every
// "create" here is find-or-create by name, so re-running the build after
// changing the Project Git URL/branch is always safe.

export interface EeBuildConfigInput {
  name: string;
  imageStreamName: string;
  gitUrl: string;
  gitBranch: string;
  contextDir: string;
  dockerfilePath: string;
  /** Name of a `kubernetes.io/basic-auth` or `kubernetes.io/ssh-auth`
   * Secret already in this namespace, for a private repo. Omit for a
   * public one. */
  gitSecretName?: string;
}

/** ImageStreams are what actually create the internal-registry
 * repository a BuildConfig's `output.to` can push to — creating one
 * ahead of the BuildConfig (rather than relying on it to be
 * auto-created) keeps this idempotent-by-inspection like everything else
 * here. */
export async function findOrCreateEeImageStream(name: string): Promise<void> {
  const ns = openshiftNamespace();
  const path = `/apis/image.openshift.io/v1/namespaces/${ns}/imagestreams/${name}`;
  const existing = await ocpFetch(path);
  if (existing.ok) return;
  if (existing.status !== 404) throw new Error(`OpenShift get imagestream: HTTP ${existing.status}`);
  const response = await ocpFetch(`/apis/image.openshift.io/v1/namespaces/${ns}/imagestreams`, {
    method: "POST",
    body: JSON.stringify({
      apiVersion: "image.openshift.io/v1",
      kind: "ImageStream",
      metadata: { name, namespace: ns, labels: { "app.kubernetes.io/managed-by": "agentstore" } },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenShift create imagestream failed (${response.status}): ${text.slice(0, 400)}`);
  }
}

/** Finds-or-creates the BuildConfig; if it already exists, PUTs the spec
 * in place (fetching `resourceVersion` first, as the Kubernetes API
 * requires for updates) so a changed Git URL/branch always takes effect
 * on the next build, the same way findOrCreateExecutionEnvironment()
 * patches an existing AAP object rather than leaving it stale. */
export async function findOrCreateEeBuildConfig(input: EeBuildConfigInput): Promise<void> {
  const ns = openshiftNamespace();
  const path = `/apis/build.openshift.io/v1/namespaces/${ns}/buildconfigs/${input.name}`;
  const spec = {
    source: {
      type: "Git",
      git: { uri: input.gitUrl, ref: input.gitBranch },
      contextDir: input.contextDir,
      ...(input.gitSecretName ? { sourceSecret: { name: input.gitSecretName } } : {}),
    },
    strategy: {
      type: "Docker",
      dockerStrategy: { dockerfilePath: input.dockerfilePath },
    },
    output: {
      to: { kind: "ImageStreamTag", name: `${input.imageStreamName}:latest` },
    },
  };
  const existing = await ocpFetch(path);
  if (existing.ok) {
    const body = (await existing.json()) as { metadata: { resourceVersion: string } };
    const updated = await ocpFetch(path, {
      method: "PUT",
      body: JSON.stringify({
        apiVersion: "build.openshift.io/v1",
        kind: "BuildConfig",
        metadata: { name: input.name, namespace: ns, resourceVersion: body.metadata.resourceVersion },
        spec,
      }),
    });
    if (!updated.ok) {
      const text = await updated.text();
      throw new Error(`OpenShift update buildconfig failed (${updated.status}): ${text.slice(0, 400)}`);
    }
    return;
  }
  if (existing.status !== 404) throw new Error(`OpenShift get buildconfig: HTTP ${existing.status}`);
  const response = await ocpFetch(`/apis/build.openshift.io/v1/namespaces/${ns}/buildconfigs`, {
    method: "POST",
    body: JSON.stringify({
      apiVersion: "build.openshift.io/v1",
      kind: "BuildConfig",
      metadata: { name: input.name, namespace: ns, labels: { "app.kubernetes.io/managed-by": "agentstore" } },
      spec,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenShift create buildconfig failed (${response.status}): ${text.slice(0, 400)}`);
  }
}

/** Triggers a new Build from the BuildConfig (like `oc start-build`);
 * returns the created Build object's name (e.g. `agentstore-ee-3`) to
 * poll via getEeBuildStatus(). */
export async function startEeBuild(buildConfigName: string): Promise<{ buildName: string }> {
  const ns = openshiftNamespace();
  const response = await ocpFetch(
    `/apis/build.openshift.io/v1/namespaces/${ns}/buildconfigs/${buildConfigName}/instantiate`,
    {
      method: "POST",
      body: JSON.stringify({
        kind: "BuildRequest",
        apiVersion: "build.openshift.io/v1",
        metadata: { name: buildConfigName },
      }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenShift start build failed (${response.status}): ${text.slice(0, 400)}`);
  }
  const body = (await response.json()) as { metadata?: { name?: string } };
  const buildName = body.metadata?.name;
  if (!buildName) throw new Error("OpenShift build started but returned no build name");
  return { buildName };
}

export interface EeBuildStatusResult {
  /** "New" | "Pending" | "Running" | "Complete" | "Failed" | "Error" | "Cancelled". */
  phase: string;
  message?: string;
}

export async function getEeBuildStatus(buildName: string): Promise<EeBuildStatusResult> {
  const ns = openshiftNamespace();
  const response = await ocpFetch(`/apis/build.openshift.io/v1/namespaces/${ns}/builds/${buildName}`);
  if (!response.ok) throw new Error(`OpenShift get build ${buildName}: HTTP ${response.status}`);
  const body = (await response.json()) as {
    status?: { phase?: string; message?: string; logSnippet?: string };
  };
  return { phase: body.status?.phase ?? "Unknown", message: body.status?.message ?? body.status?.logSnippet };
}

/** Reads back the built image's pullable reference (including registry
 * host + digest) once a Build lands its output on this ImageStreamTag —
 * exactly what AAP's Execution Environment `image` field needs. */
export async function getEeImageReference(imageStreamName: string, tag = "latest"): Promise<string> {
  const ns = openshiftNamespace();
  const response = await ocpFetch(
    `/apis/image.openshift.io/v1/namespaces/${ns}/imagestreamtags/${imageStreamName}:${tag}`
  );
  if (!response.ok) throw new Error(`OpenShift get imagestreamtag: HTTP ${response.status}`);
  const body = (await response.json()) as { image?: { dockerImageReference?: string } };
  const ref = body.image?.dockerImageReference;
  if (!ref) throw new Error("OpenShift imagestreamtag has no image reference yet");
  return ref;
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
