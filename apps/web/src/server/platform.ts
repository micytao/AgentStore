import fs from "node:fs";
import path from "node:path";
import type { PlatformSettings, PlatformStatus } from "@agentstore/shared";
import {
  applyPlatformEnv,
  checkAgentSandboxController,
  isOpenshiftConfigured,
  listAgentDeployments,
  pingOpenshift,
} from "@agentstore/engine-openshift";
import { applyOpenShellServiceEnv, isOpenShellServiceConfigured, pingOpenShellService } from "@agentstore/engine-openshell";
// Note: deliberately calling checkAgentSandboxController() directly from
// @agentstore/engine-openshift here, not the checkAgentSandboxStatus()
// wrapper in ./agentSandbox — that module needs to import
// getPlatformSettings/savePlatformSettings/ensurePlatformEnv from *this*
// file for the "Install Agent Sandbox Service" build+deploy flow, and a
// platform.ts <-> agentSandbox.ts circular import is easy to get wrong
// silently (works until it doesn't, depending on evaluation order).
// One-directional (agentSandbox.ts -> platform.ts) avoids that entirely.

const DEFAULT_SETTINGS: PlatformSettings = {
  openshiftApiUrl: "",
  openshiftNamespace: "agent-workloads",
  openshiftConsoleUrl: "",
  openshiftInsecureTls: true,
  projectGitUrl: "",
  projectGitBranch: "main",
  openshellServiceUrl: "",
  // Real, published chart — see docs.nvidia.com/openshell/kubernetes/openshift.
  // Left editable for a private mirror or pinned dev build.
  openshellGatewayChartRef: "oci://ghcr.io/nvidia/openshell/helm-chart",
  openshellGatewayChartVersion: "",
  openshellGatewayNamespace: "openshell",
  openshellGatewayWorkloadKind: "statefulset",
};

function dataDir(): string {
  if (process.env.SECRETS_DATA_DIR) return process.env.SECRETS_DATA_DIR;
  const candidates = [
    path.resolve(process.cwd(), ".data"),
    path.resolve(process.cwd(), "../../.data"),
    path.resolve(__dirname, "../../../../.data"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

function settingsPath(): string {
  return path.join(dataDir(), "platform.json");
}

function loadFromDisk(): PlatformSettings {
  const file = settingsPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PlatformSettings>;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let cached: PlatformSettings | null = null;

export function getPlatformSettings(): PlatformSettings {
  if (!cached) cached = loadFromDisk();
  return cached;
}

export function savePlatformSettings(patch: Partial<PlatformSettings>): PlatformSettings {
  const next: PlatformSettings = { ...getPlatformSettings(), ...patch };
  if (next.openshiftNamespace.trim() === "") next.openshiftNamespace = "agent-workloads";
  if (next.openshellGatewayNamespace.trim() === "") next.openshellGatewayNamespace = "openshell";
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  cached = next;
  applyPlatformEnv(next);
  applyOpenShellServiceEnv(next);
  return next;
}

export function ensurePlatformEnv(): void {
  const settings = getPlatformSettings();
  applyPlatformEnv(settings);
  applyOpenShellServiceEnv(settings);
}

/** Clears all cluster-specific state (deploy statuses, build results,
 *  image references) while keeping connection URLs — those survive a
 *  cluster switch. */
export function resetClusterState(): PlatformSettings {
  return savePlatformSettings({
    // Image refs from old cluster's internal registry
    agentRuntimeImage: undefined,
    // Deploy / build status blobs
    agentstoreDeploy: undefined,
    rhdhDeploy: undefined,
    agentRuntimeBuild: undefined,
    agentSandboxServiceInstall: undefined,
    openshellGatewayDeployment: undefined,
    // Sync token — will be regenerated on next deploy
    syncToken: undefined,
    // OpenShell service URL — old cluster route
    openshellServiceUrl: "",
  });
}

async function probeOpenshift(): Promise<PlatformStatus["openshift"]> {
  const configured = isOpenshiftConfigured();
  if (!configured) {
    return {
      configured: false,
      connected: false,
      error: "Not configured",
      deployments: [],
      agentSandboxController: { installed: false, error: "Not configured" },
    };
  }
  const ping = await pingOpenshift();
  if (!ping.ok) {
    return {
      configured: true,
      connected: false,
      error: ping.error,
      deployments: [],
      agentSandboxController: { installed: false, error: ping.error },
    };
  }
  try {
    const [deployments, agentSandboxController] = await Promise.all([
      listAgentDeployments(),
      checkAgentSandboxController(),
    ]);
    return { configured: true, connected: true, deployments, agentSandboxController };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      error: err instanceof Error ? err.message : String(err),
      deployments: [],
      agentSandboxController: await checkAgentSandboxController(),
    };
  }
}

async function probeOpenshell(): Promise<PlatformStatus["openshellService"]> {
  const configured = isOpenShellServiceConfigured();
  if (!configured) {
    return { configured: false, connected: false, error: "Not configured" };
  }
  const ping = await pingOpenShellService();
  return { configured: true, connected: ping.ok, error: ping.ok ? undefined : ping.error };
}

export async function getPlatformStatus(): Promise<PlatformStatus> {
  ensurePlatformEnv();
  const [openshift, openshellService] = await Promise.all([
    probeOpenshift(),
    probeOpenshell(),
  ]);
  return { settings: getPlatformSettings(), openshift, openshellService };
}

export type PlatformTestTarget = "openshift";

export async function testPlatformTarget(target: PlatformTestTarget): Promise<{
  settings: PlatformStatus["settings"];
  openshift?: PlatformStatus["openshift"];
}> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  return { settings, openshift: await probeOpenshift() };
}
