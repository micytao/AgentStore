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
