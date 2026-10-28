/** Connection details for the Agent Sandbox Service (Admin -> Platform +
 * Secrets), the same shape as engine-openshift/src/config.ts's OpenShift settings. */

export function openshellServiceUrl(): string {
  return (process.env.OPENSHELL_SERVICE_URL ?? "").replace(/\/$/, "");
}

export function openshellServiceToken(): string {
  return process.env.OPENSHELL_SERVICE_TOKEN ?? "";
}

export function isOpenShellServiceConfigured(): boolean {
  return Boolean(openshellServiceUrl() && openshellServiceToken());
}

export function applyOpenShellServiceEnv(settings: { openshellServiceUrl: string }): void {
  process.env.OPENSHELL_SERVICE_URL = settings.openshellServiceUrl;
}
