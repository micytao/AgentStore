/** Connection details for the Agent Sandbox Service (Admin -> Platform +
 * Secrets), the same shape as engine-ansible/src/config.ts's AAP settings. */

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
