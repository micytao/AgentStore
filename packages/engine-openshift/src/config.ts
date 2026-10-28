/** Platform connection details. URLs come from Admin → Platform; tokens from the vault. */

export function openshiftApiUrl(): string {
  return (process.env.OPENSHIFT_API_URL ?? "").replace(/\/$/, "");
}

export function openshiftToken(): string {
  return process.env.OPENSHIFT_TOKEN ?? "";
}

export function openshiftNamespace(): string {
  return process.env.OPENSHIFT_NAMESPACE || "agent-workloads";
}

export function openshiftConsoleUrl(): string {
  return (process.env.OPENSHIFT_CONSOLE_URL ?? "").replace(/\/$/, "");
}

export function openshiftInsecureTls(): boolean {
  return process.env.OPENSHIFT_INSECURE_TLS === "true";
}

/** Image for the agent-runtime container (apps/agent-runtime), deployed
 * once per `generic-chat` listing as a persistent chat Deployment. */
export function agentRuntimeImage(): string {
  return process.env.AGENT_RUNTIME_IMAGE || "agent-runtime:dev";
}

export function isOpenshiftConfigured(): boolean {
  return Boolean(openshiftApiUrl() && openshiftToken());
}

export function openshiftDeploymentConsoleUrl(name: string, namespace: string): string | undefined {
  const base = openshiftConsoleUrl();
  if (!base) return undefined;
  return `${base}/k8s/ns/${namespace}/apps~v1~Deployment/${name}`;
}

// ---------------------------------------------------------------------------
// Kubernetes labeling — every resource AgentStore creates gets a consistent
// set of labels for grouping, filtering, and console visibility.
//
//   app: agentstore                              — quick CLI filter
//   app.kubernetes.io/part-of: agentstore        — groups the whole app
//   app.kubernetes.io/managed-by: agentstore     — provenance
//   app.kubernetes.io/component: <component>     — sub-system role
//   app.kubernetes.io/name: <name>               — specific workload
// ---------------------------------------------------------------------------

export type AgentStoreComponent =
  | "console"
  | "agent-runtime"
  | "agent-sandbox-service"
  | "gateway"
  | "build"
  | "rhdh"
  | "infrastructure";

/** Returns the standard label set for any K8s resource managed by AgentStore.
 *  `component` is required; `name` and `extra` are optional. */
export function standardLabels(
  component: AgentStoreComponent,
  name?: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    app: "agentstore",
    "app.kubernetes.io/part-of": "agentstore",
    "app.kubernetes.io/managed-by": "agentstore",
    "app.kubernetes.io/component": component,
    ...(name ? { "app.kubernetes.io/name": name } : {}),
    ...extra,
  };
}

export function applyPlatformEnv(settings: {
  openshiftApiUrl: string;
  openshiftNamespace: string;
  openshiftConsoleUrl: string;
  openshiftInsecureTls?: boolean;
}): void {
  process.env.OPENSHIFT_API_URL = settings.openshiftApiUrl;
  process.env.OPENSHIFT_NAMESPACE = settings.openshiftNamespace || "agent-workloads";
  process.env.OPENSHIFT_CONSOLE_URL = settings.openshiftConsoleUrl;
  process.env.OPENSHIFT_INSECURE_TLS = settings.openshiftInsecureTls ? "true" : "false";
}
