/** Platform connection details. URLs come from Admin → Platform; tokens from the vault. */

export function aapControllerUrl(): string {
  return (process.env.AAP_CONTROLLER_URL ?? "").replace(/\/$/, "");
}

export function aapToken(): string {
  return process.env.AAP_TOKEN ?? "";
}

export function aapDefaultJobTemplateId(): number | undefined {
  const raw = process.env.AAP_JOB_TEMPLATE_ID;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function aapConsoleUrl(): string {
  return (process.env.AAP_CONSOLE_URL ?? aapControllerUrl()).replace(/\/$/, "");
}

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

export function agentRunnerImage(): string {
  return process.env.AGENT_RUNNER_IMAGE || "agent-runner:dev";
}

export function isAapConfigured(): boolean {
  return Boolean(aapControllerUrl() && aapToken());
}

export function isOpenshiftConfigured(): boolean {
  return Boolean(openshiftApiUrl() && openshiftToken());
}

export function aapJobUrl(jobId: string | number): string | undefined {
  const base = aapConsoleUrl();
  if (!base) return undefined;
  return `${base}/#/jobs/playbook/${jobId}/details`;
}

export function openshiftJobConsoleUrl(name: string, namespace: string): string | undefined {
  const base = openshiftConsoleUrl();
  if (!base) return undefined;
  return `${base}/k8s/ns/${namespace}/batch~v1~Job/${name}`;
}

export function applyPlatformEnv(settings: {
  aapControllerUrl: string;
  aapJobTemplateId: number | "";
  aapConsoleUrl: string;
  openshiftApiUrl: string;
  openshiftNamespace: string;
  openshiftConsoleUrl: string;
}): void {
  process.env.AAP_CONTROLLER_URL = settings.aapControllerUrl;
  process.env.AAP_CONSOLE_URL = settings.aapConsoleUrl;
  process.env.AAP_JOB_TEMPLATE_ID =
    settings.aapJobTemplateId === "" ? "" : String(settings.aapJobTemplateId);
  process.env.OPENSHIFT_API_URL = settings.openshiftApiUrl;
  process.env.OPENSHIFT_NAMESPACE = settings.openshiftNamespace || "agent-workloads";
  process.env.OPENSHIFT_CONSOLE_URL = settings.openshiftConsoleUrl;
}
