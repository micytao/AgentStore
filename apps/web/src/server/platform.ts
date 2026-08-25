import fs from "node:fs";
import path from "node:path";
import type { PlatformSettings, PlatformStatus } from "@agentstore/shared";
import {
  applyPlatformEnv,
  isAapConfigured,
  isOpenshiftConfigured,
  listAgentJobs,
  listJobTemplates,
  listRecentJobs,
  pingAap,
  pingOpenshift,
} from "@agentstore/engine-ansible";
import { applyOpenShellServiceEnv, isOpenShellServiceConfigured, pingOpenShellService } from "@agentstore/engine-openshell";

const DEFAULT_SETTINGS: PlatformSettings = {
  aapControllerUrl: "",
  aapJobTemplateId: "",
  aapConsoleUrl: "",
  aapInsecureTls: true,
  openshiftApiUrl: "",
  openshiftNamespace: "agent-workloads",
  openshiftConsoleUrl: "",
  openshiftInsecureTls: true,
  openshellServiceUrl: "",
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

async function probeAap(): Promise<PlatformStatus["aap"]> {
  const configured = isAapConfigured();
  if (!configured) {
    return { configured: false, connected: false, error: "Not configured", jobTemplates: [], recentJobs: [] };
  }
  const ping = await pingAap();
  if (!ping.ok) {
    return { configured: true, connected: false, error: ping.error, jobTemplates: [], recentJobs: [] };
  }
  try {
    const [jobTemplates, recentJobs] = await Promise.all([listJobTemplates(), listRecentJobs(12)]);
    return { configured: true, connected: true, jobTemplates, recentJobs };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      error: err instanceof Error ? err.message : String(err),
      jobTemplates: [],
      recentJobs: [],
    };
  }
}

async function probeOpenshift(): Promise<PlatformStatus["openshift"]> {
  const configured = isOpenshiftConfigured();
  if (!configured) {
    return { configured: false, connected: false, error: "Not configured", jobs: [] };
  }
  const ping = await pingOpenshift();
  if (!ping.ok) {
    return { configured: true, connected: false, error: ping.error, jobs: [] };
  }
  try {
    return { configured: true, connected: true, jobs: await listAgentJobs() };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      error: err instanceof Error ? err.message : String(err),
      jobs: [],
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
  const [aap, openshift, openshellService] = await Promise.all([
    probeAap(),
    probeOpenshift(),
    probeOpenshell(),
  ]);
  return { settings: getPlatformSettings(), aap, openshift, openshellService };
}

export type PlatformTestTarget = "aap" | "openshift";

export async function testPlatformTarget(target: PlatformTestTarget): Promise<{
  settings: PlatformStatus["settings"];
  aap?: PlatformStatus["aap"];
  openshift?: PlatformStatus["openshift"];
}> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  if (target === "aap") return { settings, aap: await probeAap() };
  return { settings, openshift: await probeOpenshift() };
}
