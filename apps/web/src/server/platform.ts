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

const DEFAULT_SETTINGS: PlatformSettings = {
  aapControllerUrl: "",
  aapJobTemplateId: "",
  aapConsoleUrl: "",
  openshiftApiUrl: "",
  openshiftNamespace: "agent-workloads",
  openshiftConsoleUrl: "",
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
  return next;
}

export function ensurePlatformEnv(): void {
  applyPlatformEnv(getPlatformSettings());
}

export async function getPlatformStatus(): Promise<PlatformStatus> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();

  const aapPing = isAapConfigured() ? await pingAap() : { ok: false, error: "Not configured" };
  const ocpPing = isOpenshiftConfigured()
    ? await pingOpenshift()
    : { ok: false, error: "Not configured" };

  let jobTemplates: PlatformStatus["aap"]["jobTemplates"] = [];
  let recentJobs: PlatformStatus["aap"]["recentJobs"] = [];
  if (aapPing.ok) {
    try {
      jobTemplates = await listJobTemplates();
      recentJobs = await listRecentJobs(12);
    } catch (err) {
      return {
        settings,
        aap: {
          configured: isAapConfigured(),
          connected: false,
          error: err instanceof Error ? err.message : String(err),
          jobTemplates: [],
          recentJobs: [],
        },
        openshift: {
          configured: isOpenshiftConfigured(),
          connected: ocpPing.ok,
          error: ocpPing.error,
          jobs: [],
        },
      };
    }
  }

  let jobs: PlatformStatus["openshift"]["jobs"] = [];
  if (ocpPing.ok) {
    try {
      jobs = await listAgentJobs();
    } catch (err) {
      return {
        settings,
        aap: {
          configured: isAapConfigured(),
          connected: aapPing.ok,
          error: aapPing.error,
          jobTemplates,
          recentJobs,
        },
        openshift: {
          configured: isOpenshiftConfigured(),
          connected: false,
          error: err instanceof Error ? err.message : String(err),
          jobs: [],
        },
      };
    }
  }

  return {
    settings,
    aap: {
      configured: isAapConfigured(),
      connected: aapPing.ok,
      error: aapPing.ok ? undefined : aapPing.error,
      jobTemplates,
      recentJobs,
    },
    openshift: {
      configured: isOpenshiftConfigured(),
      connected: ocpPing.ok,
      error: ocpPing.ok ? undefined : ocpPing.error,
      jobs,
    },
  };
}
