import { randomBytes } from "node:crypto";
import type { OpenshiftDeploymentSummary } from "@agentstore/shared";
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
  // Every call here is live cluster state (job/build status, logs,
  // image references) — Next.js's App Router patches the global fetch()
  // to cache GET requests by default, which would otherwise make
  // repeated polls (e.g. the build log tail) silently return a stale
  // snapshot instead of fresh data.
  return fetch(`${base}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    ...(dispatcher ? { dispatcher } : {}),
  } as RequestInit);
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

/** Live preflight for the OpenShell tab's "Agent Sandbox controller"
 * status (installed/missing) — GETs the cluster's API discovery root
 * (`/apis`, the same general "ask the server what it serves" technique
 * as controllerApiPrefix() in aap.ts, just against Kubernetes's own
 * discovery endpoint instead of AAP's) and checks whether
 * `agents.x-k8s.io` is among the served API groups — exactly what the
 * OpenShell Helm chart's own preflight template checks for (see
 * ansible/provision-openshell-gateway.yml's header comment: "neither
 * agents.x-k8s.io/v1beta1 nor v1alpha1 is served"). Read-only,
 * low-privilege (any authenticated user can list API groups), so this
 * works regardless of whether the configured token can actually install
 * the controller. Never throws — mirrors pingOpenshift()'s style. */
export async function checkAgentSandboxController(): Promise<{ installed: boolean; error?: string }> {
  if (!isOpenshiftConfigured()) {
    return { installed: false, error: "OpenShift API URL or token is missing" };
  }
  try {
    const response = await ocpFetch("/apis");
    if (!response.ok) {
      return { installed: false, error: `OpenShift API returned ${response.status} listing API groups` };
    }
    const body = (await response.json()) as { groups?: { name?: string }[] };
    const installed = (body.groups ?? []).some((group) => group.name === "agents.x-k8s.io");
    return { installed };
  } catch (err) {
    return { installed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Generic small manifest apply (Agent Sandbox controller + service) -
//
// Shared by two unrelated "click a button, apply some YAML" admin
// actions: "Install Agent Sandbox controller" (deploy/openshift/
// agent-sandbox-crds.yaml, a pinned copy of kubernetes-sigs/
// agent-sandbox's release manifest) and "Install Agent Sandbox Service"
// (deploy/openshift/agent-sandbox-service.yaml, this repo's own
// Deployment/Service/Route — see agentSandboxServiceBuild.ts one level
// up for the OpenShift BuildConfig that builds its image first). Both
// use the same OPENSHIFT_TOKEN as everything else in this file. Not a
// generic dynamic-discovery "oc apply" engine — just the handful of
// kinds those two vendored files actually contain. If either is ever
// regenerated/edited with a different resource mix, extend
// AGENT_SANDBOX_RESOURCE_ENDPOINTS below first; applyAgentSandboxManifests()
// throws a clear error naming the unrecognized kind rather than silently
// skipping it.

interface AgentSandboxResourceEndpoint {
  /** Cluster- or namespace-scoped REST collection path (without the
   * trailing `/<name>` — appended per-call by applyOneAgentSandboxManifest). */
  collectionPath: (namespace?: string) => string;
  namespaced: boolean;
}

const AGENT_SANDBOX_RESOURCE_ENDPOINTS: Record<string, AgentSandboxResourceEndpoint> = {
  "v1/Namespace": { namespaced: false, collectionPath: () => "/api/v1/namespaces" },
  "v1/ServiceAccount": {
    namespaced: true,
    collectionPath: (ns) => `/api/v1/namespaces/${ns}/serviceaccounts`,
  },
  "v1/Service": {
    namespaced: true,
    collectionPath: (ns) => `/api/v1/namespaces/${ns}/services`,
  },
  "apps/v1/Deployment": {
    namespaced: true,
    collectionPath: (ns) => `/apis/apps/v1/namespaces/${ns}/deployments`,
  },
  "rbac.authorization.k8s.io/v1/ClusterRole": {
    namespaced: false,
    collectionPath: () => "/apis/rbac.authorization.k8s.io/v1/clusterroles",
  },
  "rbac.authorization.k8s.io/v1/ClusterRoleBinding": {
    namespaced: false,
    collectionPath: () => "/apis/rbac.authorization.k8s.io/v1/clusterrolebindings",
  },
  "rbac.authorization.k8s.io/v1/RoleBinding": {
    namespaced: true,
    collectionPath: (ns) => `/apis/rbac.authorization.k8s.io/v1/namespaces/${ns}/rolebindings`,
  },
  "apiextensions.k8s.io/v1/CustomResourceDefinition": {
    namespaced: false,
    collectionPath: () => "/apis/apiextensions.k8s.io/v1/customresourcedefinitions",
  },
  // Only needed by deploy/openshift/agent-sandbox-service.yaml, not the
  // controller manifest — Routes are an OpenShift (not upstream
  // Kubernetes) extension API.
  "route.openshift.io/v1/Route": {
    namespaced: true,
    collectionPath: (ns) => `/apis/route.openshift.io/v1/namespaces/${ns}/routes`,
  },
  // OLM resources for operator installs (RHDH, etc.)
  "operators.coreos.com/v1/OperatorGroup": {
    namespaced: true,
    collectionPath: (ns) => `/apis/operators.coreos.com/v1/namespaces/${ns}/operatorgroups`,
  },
  "operators.coreos.com/v1alpha1/Subscription": {
    namespaced: true,
    collectionPath: (ns) => `/apis/operators.coreos.com/v1alpha1/namespaces/${ns}/subscriptions`,
  },
  // Core resources needed for AgentStore deploy + RHDH instance provision
  "v1/PersistentVolumeClaim": {
    namespaced: true,
    collectionPath: (ns) => `/api/v1/namespaces/${ns}/persistentvolumeclaims`,
  },
  "v1/ConfigMap": {
    namespaced: true,
    collectionPath: (ns) => `/api/v1/namespaces/${ns}/configmaps`,
  },
  "v1/Secret": {
    namespaced: true,
    collectionPath: (ns) => `/api/v1/namespaces/${ns}/secrets`,
  },
};

interface AgentSandboxManifestMetadata {
  name?: string;
  namespace?: string;
  resourceVersion?: string;
}

/** Idempotent create-or-update of a single manifest document — GET by
 * name first (same convention as findOrCreateEeBuildConfig() below),
 * PUT with the fetched resourceVersion if it already exists, POST to
 * create if not. Throws immediately (naming the object's kind/name) on
 * any other failure, e.g. a 403 — applyAgentSandboxManifests() relies on
 * this to fail fast rather than leaving a silent partial apply. */
async function applyOneAgentSandboxManifest(doc: Record<string, unknown>): Promise<string> {
  const apiVersion = doc.apiVersion as string | undefined;
  const kind = doc.kind as string | undefined;
  const metadata = doc.metadata as AgentSandboxManifestMetadata | undefined;
  const name = metadata?.name;
  if (!apiVersion || !kind || !name) {
    throw new Error(`Manifest document is missing apiVersion/kind/metadata.name: ${JSON.stringify(doc).slice(0, 200)}`);
  }
  const label = `${kind}/${name}`;
  const endpoint = AGENT_SANDBOX_RESOURCE_ENDPOINTS[`${apiVersion}/${kind}`];
  if (!endpoint) {
    throw new Error(
      `Don't know how to apply ${label} (${apiVersion}) — extend AGENT_SANDBOX_RESOURCE_ENDPOINTS in openshift.ts.`
    );
  }
  const namespace = metadata?.namespace;
  if (endpoint.namespaced && !namespace) {
    throw new Error(`${label} has no metadata.namespace but is a namespaced resource`);
  }
  const collectionPath = endpoint.collectionPath(namespace);
  const itemPath = `${collectionPath}/${name}`;

  const existing = await ocpFetch(itemPath);
  if (existing.ok) {
    // PersistentVolumeClaims have an immutable spec after creation —
    // attempting a PUT will always 422.  Just treat "already exists" as
    // success for these resources.
    if (kind === "PersistentVolumeClaim") {
      return label;
    }

    const existingBody = (await existing.json()) as { metadata?: { resourceVersion?: string } };
    const updated = await ocpFetch(itemPath, {
      method: "PUT",
      body: JSON.stringify({
        ...doc,
        metadata: { ...metadata, resourceVersion: existingBody.metadata?.resourceVersion },
      }),
    });
    if (!updated.ok) {
      const text = await updated.text();
      throw new Error(`OpenShift update ${label} failed (${updated.status}): ${text.slice(0, 400)}`);
    }
    return label;
  }
  if (existing.status !== 404) {
    throw new Error(`OpenShift get ${label}: HTTP ${existing.status}`);
  }
  const created = await ocpFetch(collectionPath, {
    method: "POST",
    body: JSON.stringify(doc),
  });
  if (!created.ok) {
    const text = await created.text();
    throw new Error(`OpenShift create ${label} failed (${created.status}): ${text.slice(0, 400)}`);
  }
  return label;
}

/** Applies the Agent Sandbox controller manifest — Namespace, CRD,
 * ClusterRole/Binding, ServiceAccount, Service, Deployment (see
 * deploy/openshift/agent-sandbox-crds.yaml) — one document at a time, in
 * the order given (the vendored file's own document order already puts
 * the Namespace/CRD ahead of the things that depend on them). Stops on
 * the first failure — typically a 403 if the configured OPENSHIFT_TOKEN
 * doesn't have cluster-admin-equivalent RBAC — rather than leaving a
 * silent partial apply; the caller (installAgentSandboxController() in
 * apps/web/src/server/agentSandbox.ts) surfaces that error verbatim,
 * pointing the admin at the manual `oc apply` fallback documented in
 * deploy/openshift/README.md section 5a. */
export async function applyAgentSandboxManifests(docs: Record<string, unknown>[]): Promise<{ applied: string[] }> {
  const applied: string[] = [];
  for (const doc of docs) {
    // yaml.loadAll() can yield null/undefined for stray "---" document
    // separators (e.g. a leading one before the first real document) —
    // skip those rather than treating them as malformed manifests.
    if (!doc || !doc.kind) continue;
    applied.push(await applyOneAgentSandboxManifest(doc));
  }
  return { applied };
}

// --- Agent Sandbox Service install (build+deploy, see agentSandboxServiceBuild.ts) -

/** Finds-or-creates a Secret holding a single random bearer token — used
 * for the "Install Agent Sandbox Service" action's `agent-sandbox-service-
 * token` Secret (the pod's own OPENSHELL_SERVICE_TOKEN env var, via
 * `secretKeyRef` in deploy/openshift/agent-sandbox-service.yaml). If the
 * Secret already exists (e.g. a previous install, or one created manually
 * per the old README instructions), its existing value is returned
 * unchanged rather than being overwritten — the running pod's env var and
 * any other client already holding that token would otherwise silently
 * break. Only generates a fresh one when the Secret is genuinely absent. */
export async function findOrCreateAgentSandboxServiceTokenSecret(
  namespace: string,
  name: string,
  key: string
): Promise<{ token: string; created: boolean }> {
  const path = `/api/v1/namespaces/${namespace}/secrets/${name}`;
  const existing = await ocpFetch(path);
  if (existing.ok) {
    const body = (await existing.json()) as { data?: Record<string, string> };
    const encoded = body.data?.[key];
    if (encoded) {
      return { token: Buffer.from(encoded, "base64").toString("utf8"), created: false };
    }
    // Secret exists but doesn't have this key yet (e.g. created for a
    // different purpose) — fall through and add it via a fresh POST
    // would conflict (409), so this is the one case worth a clear error
    // rather than silently generating a token nothing will ever read.
    throw new Error(`Secret ${name} in namespace ${namespace} exists but has no "${key}" key.`);
  }
  if (existing.status !== 404) {
    throw new Error(`OpenShift get secret ${name}: HTTP ${existing.status}`);
  }
  const token = randomBytes(32).toString("hex");
  const response = await ocpFetch(`/api/v1/namespaces/${namespace}/secrets`, {
    method: "POST",
    body: JSON.stringify({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name, namespace, labels: { "app.kubernetes.io/managed-by": "agentstore" } },
      stringData: { [key]: token },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenShift create secret ${name} failed (${response.status}): ${text.slice(0, 400)}`);
  }
  return { token, created: true };
}

/** Creates or updates a Kubernetes Opaque Secret with the given key/value.
 * Used to push a user-supplied token (e.g. GITHUB_TOKEN for npm registry
 * auth) into the namespace so a BuildConfig can reference it via
 * `secretKeyRef`. Idempotent: if the Secret already has the same value,
 * it's left untouched. */
export async function ensureSecretValue(
  namespace: string,
  name: string,
  key: string,
  value: string
): Promise<void> {
  const path = `/api/v1/namespaces/${namespace}/secrets/${name}`;
  const existing = await ocpFetch(path);
  if (existing.ok) {
    const body = (await existing.json()) as { data?: Record<string, string>; metadata: { resourceVersion: string } };
    const current = body.data?.[key] ? Buffer.from(body.data[key], "base64").toString("utf8") : undefined;
    if (current === value) return;
    const updated = await ocpFetch(path, {
      method: "PUT",
      body: JSON.stringify({
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name, namespace, resourceVersion: body.metadata.resourceVersion, labels: { "app.kubernetes.io/managed-by": "agentstore" } },
        stringData: { ...Object.fromEntries(Object.entries(body.data ?? {}).map(([k, v]) => [k, Buffer.from(v, "base64").toString("utf8")])), [key]: value },
      }),
    });
    if (!updated.ok) {
      const text = await updated.text();
      throw new Error(`OpenShift update secret ${name} failed (${updated.status}): ${text.slice(0, 400)}`);
    }
    return;
  }
  if (existing.status !== 404) throw new Error(`OpenShift get secret ${name}: HTTP ${existing.status}`);
  const response = await ocpFetch(`/api/v1/namespaces/${namespace}/secrets`, {
    method: "POST",
    body: JSON.stringify({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name, namespace, labels: { "app.kubernetes.io/managed-by": "agentstore" } },
      stringData: { [key]: value },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenShift create secret ${name} failed (${response.status}): ${text.slice(0, 400)}`);
  }
}

/** Deployment readiness check for the "Install Agent Sandbox Service"
 * action's final "waiting for pod rollout" phase — true once at least
 * one replica is Ready, the same bar listAgentDeployments() uses for
 * every other Deployment this file tracks. Also surfaces `stalledReason`
 * from the Deployment's own status.conditions (a `ReplicaFailure` like
 * "serviceaccount ... not found", or a `Progressing`/
 * `ProgressDeadlineExceeded`) so a caller polling this can tell a
 * genuinely-stuck rollout apart from one that's merely still pulling an
 * image or waiting out its readinessProbe's initialDelaySeconds — see
 * refreshAgentSandboxServiceInstall()'s use of this field. */
export async function getAgentSandboxServiceReadiness(
  namespace: string,
  name: string
): Promise<{ ready: boolean; readyReplicas: number; stalledReason?: string }> {
  const response = await ocpFetch(`/apis/apps/v1/namespaces/${namespace}/deployments/${name}`);
  if (!response.ok) throw new Error(`OpenShift get deployment ${name}: HTTP ${response.status}`);
  const body = (await response.json()) as {
    status?: {
      readyReplicas?: number;
      conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
    };
  };
  const readyReplicas = body.status?.readyReplicas ?? 0;
  const conditions = body.status?.conditions ?? [];
  const stalled = conditions.find(
    (c) =>
      (c.type === "ReplicaFailure" && c.status === "True") ||
      (c.type === "Progressing" && c.status === "False" && c.reason === "ProgressDeadlineExceeded")
  );
  return {
    ready: readyReplicas > 0,
    readyReplicas,
    stalledReason: stalled ? `${stalled.reason ?? "Unknown"}: ${stalled.message ?? ""}`.trim() : undefined,
  };
}

/** Nudges a stalled Deployment into retrying pod creation right away —
 * the same effect as `oc rollout restart`, done as a GET-then-PUT (this
 * file's existing idempotent-update convention) rather than a separate
 * PATCH content-type: stamps a `agentstore.io/restartedAt` annotation
 * onto the pod template so the Deployment controller sees a changed
 * template hash and rolls a fresh ReplicaSet immediately, instead of
 * waiting out its own exponential backoff from a prior FailedCreate/
 * ProgressDeadlineExceeded condition — e.g. one caused by a
 * ServiceAccount that didn't exist yet when this Deployment was first
 * applied, but does now (see getAgentSandboxServiceManifestDocs() in
 * apps/web/src/server/agentSandbox.ts, which ensures it going forward). */
export async function restartAgentSandboxServiceDeployment(namespace: string, name: string): Promise<void> {
  const path = `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`;
  const existing = await ocpFetch(path);
  if (!existing.ok) throw new Error(`OpenShift get deployment ${name}: HTTP ${existing.status}`);
  const body = (await existing.json()) as {
    spec?: { template?: { metadata?: { annotations?: Record<string, string> } } };
  };
  const template = body.spec?.template;
  if (!template) throw new Error(`Deployment ${name} has no spec.template to restart`);
  template.metadata = {
    ...(template.metadata ?? {}),
    annotations: {
      ...(template.metadata?.annotations ?? {}),
      "agentstore.io/restartedAt": new Date().toISOString(),
    },
  };
  const updated = await ocpFetch(path, { method: "PUT", body: JSON.stringify(body) });
  if (!updated.ok) {
    const text = await updated.text();
    throw new Error(`OpenShift restart deployment ${name} failed (${updated.status}): ${text.slice(0, 400)}`);
  }
}

/** Reads back the Route's externally-reachable host once applied — the
 * value auto-saved onto PlatformSettings.openshellServiceUrl. Returns
 * undefined rather than throwing if the Route isn't there yet (the
 * caller polls), same style as readGatewayDeployResult()/
 * readDeploymentResult() above. */
export async function getAgentSandboxServiceRouteHost(namespace: string, name: string): Promise<string | undefined> {
  const response = await ocpFetch(`/apis/route.openshift.io/v1/namespaces/${namespace}/routes/${name}`);
  if (!response.ok) return undefined;
  const body = (await response.json()) as { spec?: { host?: string } };
  return body.spec?.host ? `https://${body.spec.host}` : undefined;
}

export interface K8sDeployment {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
  };
}

/** Lists the actual running agent workloads on OpenShift — every
 * generic-chat agent is a `Deployment` (see
 * provision-generic-agent.yml's "Create/update the agent Deployment"
 * task), never a batch/v1 `Job`, so this queries the apps/v1 Deployments
 * API rather than Jobs (a previous version of this function queried
 * Jobs, which no playbook here has ever created — it was always
 * guaranteed to return empty). Scoped to the configured namespace only;
 * the OpenShell gateway lives in its own admin-chosen namespace and is
 * installed via a third-party Helm chart with no guaranteed AgentStore
 * label, so it intentionally isn't included here — its status is
 * already surfaced per-listing in the Catalog. */
export async function listAgentDeployments(): Promise<OpenshiftDeploymentSummary[]> {
  const ns = openshiftNamespace();
  const selector = encodeURIComponent("app.kubernetes.io/managed-by=agentstore");
  const response = await ocpFetch(
    `/apis/apps/v1/namespaces/${ns}/deployments?labelSelector=${selector}`
  );
  if (!response.ok) throw new Error(`OpenShift list deployments: HTTP ${response.status}`);
  const body = (await response.json()) as { items?: K8sDeployment[] };
  return (body.items ?? []).map((deployment) => ({
    name: deployment.metadata?.name ?? "",
    namespace: deployment.metadata?.namespace ?? ns,
    replicas: deployment.status?.replicas ?? 0,
    readyReplicas: deployment.status?.readyReplicas ?? 0,
    availableReplicas: deployment.status?.availableReplicas ?? 0,
    creationTimestamp: deployment.metadata?.creationTimestamp,
    listingId: deployment.metadata?.labels?.["agentstore/listing-id"],
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
  /** Extra env vars injected into the Docker build strategy (e.g. tokens
   * for private npm registries). Each entry is an OpenShift EnvVar object —
   * either `{ name, value }` or `{ name, valueFrom: { secretKeyRef } }`. */
  buildEnv?: Array<Record<string, unknown>>;
}

/** Ensures a Namespace exists — creates it if it doesn't. Idempotent. */
export async function ensureNamespace(name: string): Promise<void> {
  const existing = await ocpFetch(`/api/v1/namespaces/${name}`);
  if (existing.ok) return;
  if (existing.status !== 404) throw new Error(`OpenShift get namespace ${name}: HTTP ${existing.status}`);
  const response = await ocpFetch("/api/v1/namespaces", {
    method: "POST",
    body: JSON.stringify({
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name, labels: { "app.kubernetes.io/managed-by": "agentstore" } },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenShift create namespace ${name} failed (${response.status}): ${text.slice(0, 400)}`);
  }
}

/** ImageStreams are what actually create the internal-registry
 * repository a BuildConfig's `output.to` can push to — creating one
 * ahead of the BuildConfig (rather than relying on it to be
 * auto-created) keeps this idempotent-by-inspection like everything else
 * here. */
export async function findOrCreateEeImageStream(name: string, namespace?: string): Promise<void> {
  const ns = namespace ?? openshiftNamespace();
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
export async function findOrCreateEeBuildConfig(input: EeBuildConfigInput, namespace?: string): Promise<void> {
  const ns = namespace ?? openshiftNamespace();
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
      dockerStrategy: {
        dockerfilePath: input.dockerfilePath,
        ...(input.buildEnv?.length ? { env: input.buildEnv } : {}),
      },
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
export async function startEeBuild(buildConfigName: string, namespace?: string): Promise<{ buildName: string }> {
  const ns = namespace ?? openshiftNamespace();
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

export async function getEeBuildStatus(buildName: string, namespace?: string): Promise<EeBuildStatusResult> {
  const ns = namespace ?? openshiftNamespace();
  const response = await ocpFetch(`/apis/build.openshift.io/v1/namespaces/${ns}/builds/${buildName}`);
  if (!response.ok) throw new Error(`OpenShift get build ${buildName}: HTTP ${response.status}`);
  const body = (await response.json()) as {
    status?: { phase?: string; message?: string; logSnippet?: string };
  };
  return { phase: body.status?.phase ?? "Unknown", message: body.status?.message ?? body.status?.logSnippet };
}

/** Tail of a Build's log — the same content `oc logs -f bc/<name>` or the
 * OpenShift console's Build detail page shows, surfaced inside
 * AgentStore's "Build from source" mini-form so troubleshooting a
 * failed build doesn't require switching to the OpenShift console at
 * all. Unlike every other call in this file, the response body is
 * plain text, not JSON. */
export async function getEeBuildLogTail(buildName: string, tailLines = 1000, namespace?: string): Promise<string> {
  const ns = namespace ?? openshiftNamespace();
  const response = await ocpFetch(
    `/apis/build.openshift.io/v1/namespaces/${ns}/builds/${buildName}/log?tailLines=${tailLines}`
  );
  if (!response.ok) {
    // 404 here doesn't just mean "hasn't started" -- a Build's log
    // becomes unavailable once its pod is garbage-collected, which can
    // happen quickly for one that failed early. Genuinely ambiguous
    // without also checking the Build's phase, so say so plainly
    // rather than asserting a specific (possibly wrong) reason.
    if (response.status === 404) {
      return "(no log available — either the build hasn't started yet, or its pod has already been cleaned up)";
    }
    throw new Error(`OpenShift get build log: HTTP ${response.status}`);
  }
  return response.text();
}

/** Reads back the built image's pullable reference (including registry
 * host + digest) once a Build lands its output on this ImageStreamTag —
 * exactly what AAP's Execution Environment `image` field needs. */
export async function getEeImageReference(imageStreamName: string, tag = "latest", namespace?: string): Promise<string> {
  const ns = namespace ?? openshiftNamespace();
  const response = await ocpFetch(
    `/apis/image.openshift.io/v1/namespaces/${ns}/imagestreamtags/${imageStreamName}:${tag}`
  );
  if (!response.ok) throw new Error(`OpenShift get imagestreamtag: HTTP ${response.status}`);
  const body = (await response.json()) as { image?: { dockerImageReference?: string } };
  const ref = body.image?.dockerImageReference;
  if (!ref) throw new Error("OpenShift imagestreamtag has no image reference yet");
  return ref;
}

// --- RHDH operator + instance helpers -----------------------------------

/** Checks whether the RHDH operator CRD is registered on the cluster.
 * Also returns the preferred API version (e.g. "v1alpha2") so callers
 * can construct the correct Backstage CR apiVersion dynamically — the
 * version changes across RHDH releases and can't be hardcoded. */
export async function checkRhdhOperator(): Promise<{
  installed: boolean;
  apiVersion?: string;
  error?: string;
}> {
  try {
    const response = await ocpFetch("/apis/rhdh.redhat.com");
    if (!response.ok) {
      if (response.status === 404) return { installed: false };
      return { installed: false, error: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as {
      preferredVersion?: { version?: string };
      versions?: Array<{ version?: string }>;
    };
    const version =
      body.preferredVersion?.version ??
      body.versions?.[0]?.version ??
      "v1alpha2";
    return { installed: true, apiVersion: `rhdh.redhat.com/${version}` };
  } catch (err) {
    return { installed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Applies a single Backstage CR using the discovered API version.
 * The CR path is built dynamically because the version varies across
 * RHDH operator releases. */
export async function applyBackstageCR(
  namespace: string,
  name: string,
  apiVersion: string,
  spec: Record<string, unknown>
): Promise<void> {
  const version = apiVersion.replace("rhdh.redhat.com/", "");
  const collectionPath = `/apis/rhdh.redhat.com/${version}/namespaces/${namespace}/backstages`;
  const itemPath = `${collectionPath}/${name}`;

  const doc = {
    apiVersion,
    kind: "Backstage",
    metadata: {
      name,
      namespace,
      labels: { "app.kubernetes.io/managed-by": "agentstore" },
    },
    spec,
  };

  const existing = await ocpFetch(itemPath);
  if (existing.ok) {
    const body = (await existing.json()) as { metadata?: { resourceVersion?: string } };
    const updated = await ocpFetch(itemPath, {
      method: "PUT",
      body: JSON.stringify({
        ...doc,
        metadata: { ...doc.metadata, resourceVersion: body.metadata?.resourceVersion },
      }),
    });
    if (!updated.ok) {
      const text = await updated.text();
      throw new Error(`OpenShift update Backstage/${name} failed (${updated.status}): ${text.slice(0, 400)}`);
    }
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`OpenShift get Backstage/${name}: HTTP ${existing.status}`);
  }
  const created = await ocpFetch(collectionPath, {
    method: "POST",
    body: JSON.stringify(doc),
  });
  if (!created.ok) {
    const text = await created.text();
    throw new Error(`OpenShift create Backstage/${name} failed (${created.status}): ${text.slice(0, 400)}`);
  }
}

/** Checks if any Deployment in a namespace has ready replicas — useful
 * when the exact Deployment name is operator-generated and unpredictable
 * (e.g. the RHDH operator). */
export async function checkNamespaceDeploymentReadiness(namespace: string): Promise<{
  ready: boolean;
  deploymentName?: string;
  readyReplicas: number;
  stalledReason?: string;
}> {
  const response = await ocpFetch(`/apis/apps/v1/namespaces/${namespace}/deployments`);
  if (!response.ok) {
    return { ready: false, readyReplicas: 0, stalledReason: `HTTP ${response.status}` };
  }
  const body = (await response.json()) as {
    items?: Array<{
      metadata?: { name?: string };
      status?: {
        readyReplicas?: number;
        replicas?: number;
        conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
      };
    }>;
  };
  const deployments = body.items ?? [];
  if (deployments.length === 0) {
    return { ready: false, readyReplicas: 0 };
  }

  // Check if any are stalled first
  for (const d of deployments) {
    const conditions = d.status?.conditions ?? [];
    const stalled = conditions.find(
      (c) =>
        (c.type === "ReplicaFailure" && c.status === "True") ||
        (c.type === "Progressing" && c.status === "False" && c.reason === "ProgressDeadlineExceeded")
    );
    if (stalled) {
      return {
        ready: false,
        deploymentName: d.metadata?.name,
        readyReplicas: 0,
        stalledReason: `${stalled.reason ?? "Unknown"}: ${stalled.message ?? ""}`.trim(),
      };
    }
  }

  // ALL deployments with desired replicas > 0 must have readyReplicas >=
  // replicas — a single ready Deployment isn't enough when the operator
  // creates multiple (e.g. RHDH's backstage pod + supporting services).
  const wantedDeployments = deployments.filter((d) => (d.status?.replicas ?? 0) > 0);
  if (wantedDeployments.length === 0) {
    return { ready: false, readyReplicas: 0 };
  }
  const allReady = wantedDeployments.every(
    (d) => (d.status?.readyReplicas ?? 0) >= (d.status?.replicas ?? 1)
  );
  const totalReady = wantedDeployments.reduce((sum, d) => sum + (d.status?.readyReplicas ?? 0), 0);
  const firstReady = wantedDeployments.find((d) => (d.status?.readyReplicas ?? 0) > 0);

  if (allReady) {
    return {
      ready: true,
      deploymentName: firstReady?.metadata?.name,
      readyReplicas: totalReady,
    };
  }

  return { ready: false, deploymentName: firstReady?.metadata?.name, readyReplicas: totalReady };
}

/** Triggers a rollout restart on all Deployments in a namespace by
 * stamping a `agentstore.io/restartedAt` annotation on each pod
 * template — same mechanism as restartAgentSandboxServiceDeployment()
 * but without needing to know the exact name (operator-generated). */
export async function restartNamespaceDeployments(namespace: string): Promise<string[]> {
  const response = await ocpFetch(`/apis/apps/v1/namespaces/${namespace}/deployments`);
  if (!response.ok) return [];
  const body = (await response.json()) as {
    items?: Array<{
      metadata?: { name?: string };
      spec?: { template?: { metadata?: { annotations?: Record<string, string> } } };
    }>;
  };
  const restarted: string[] = [];
  for (const deploy of body.items ?? []) {
    const name = deploy.metadata?.name;
    if (!name) continue;
    const template = deploy.spec?.template;
    if (!template) continue;
    template.metadata = {
      ...(template.metadata ?? {}),
      annotations: {
        ...(template.metadata?.annotations ?? {}),
        "agentstore.io/restartedAt": new Date().toISOString(),
      },
    };
    const updated = await ocpFetch(
      `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`,
      { method: "PUT", body: JSON.stringify(deploy) }
    );
    if (updated.ok) restarted.push(name);
  }
  return restarted;
}

/** Reads the first Route in a namespace (RHDH operator auto-creates one
 * for the Backstage CR when `route.enabled: true`). */
export async function getNamespaceRouteHost(namespace: string): Promise<string | undefined> {
  const response = await ocpFetch(`/apis/route.openshift.io/v1/namespaces/${namespace}/routes`);
  if (!response.ok) return undefined;
  const body = (await response.json()) as {
    items?: Array<{ spec?: { host?: string } }>;
  };
  const host = body.items?.[0]?.spec?.host;
  return host ? `https://${host}` : undefined;
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
