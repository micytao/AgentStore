import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import type { AgentStoreDeployStatus, PlatformSettings } from "@agentstore/shared";
import {
  applyAgentSandboxManifests,
  ensureNamespace,
  getAgentStoreImageBuildLog,
  getAgentStoreImageBuildPhase,
  getAgentStoreImageBuildResult,
  getAgentSandboxServiceReadiness,
  getAgentSandboxServiceRouteHost,
  isOpenshiftConfigured,
  openshiftNamespace,
  restartAgentSandboxServiceDeployment,
  startAgentStoreImageBuild,
} from "@agentstore/engine-ansible";
import { ensurePlatformEnv, getPlatformSettings, savePlatformSettings } from "./platform";
import { exportDecryptedSecrets } from "./secrets";
import {
  readCatalogOverrides,
  readCustomListings,
  readDeletedListings,
  readProviders,
} from "./dataDirFiles";

/**
 * "Deploy AgentStore to OpenShift" admin action (Admin -> Platform ->
 * AgentStore on OpenShift). Two-phase start/poll convention:
 *
 *  1. Phase "building" — triggers an OpenShift BuildConfig that builds
 *     apps/web/Containerfile from the configured Git repo, same mechanism
 *     as agentRuntimeBuild.ts and agentSandboxServiceBuild.ts.
 *  2. Phase "deploying" — once the image is ready, applies
 *     deploy/openshift/agentstore.yaml (Namespace + PVC + Deployment +
 *     Service + Route) and waits for the Deployment to become Ready.
 *
 * Persists progress on PlatformSettings.agentstoreDeploy.
 */

const AGENTSTORE_NAMESPACE = "agentstore";
const AGENTSTORE_DEPLOY_NAME = "agentstore";

function now(): string {
  return new Date().toISOString();
}

function persist(deploy: AgentStoreDeployStatus, extra?: Partial<PlatformSettings>): PlatformSettings {
  return savePlatformSettings({ ...extra, agentstoreDeploy: deploy });
}

function resolveDeployFile(relativePath: string): string {
  const candidates = [
    path.resolve(process.cwd(), "../../", relativePath),
    path.resolve(process.cwd(), relativePath),
    path.resolve(__dirname, "../../../../", relativePath),
  ];
  return candidates.find((file) => fs.existsSync(file)) ?? candidates[0];
}

function parseManifestDocs(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) {
    throw new Error(`AgentStore manifest not found at ${file}.`);
  }
  const raw = fs.readFileSync(file, "utf8");
  const docs = yaml.loadAll(raw) as unknown[];
  return docs.filter((doc): doc is Record<string, unknown> => !!doc && typeof doc === "object");
}

/** Strip deploy-status fields from PlatformSettings — the cluster
 *  instance manages its own deploy lifecycle.  Only connection/config
 *  fields travel in the seed. */
function seedPlatformSettings(settings: PlatformSettings): Partial<PlatformSettings> {
  const {
    agentstoreDeploy: _a, rhdhDeploy: _b, eeBuild: _c,
    agentRuntimeBuild: _d, agentSandboxServiceInstall: _e,
    aapBootstrap: _f, openshellGatewayDeployment: _g,
    ...config
  } = settings;
  return config;
}

/** Generate or retrieve a stable sync token for this deploy.  Stored in
 *  platform settings so the local instance can call POST /api/admin/sync
 *  on the cluster later without a full redeploy. */
function getOrCreateSyncToken(): string {
  const settings = getPlatformSettings();
  const existing = settings.syncToken;
  if (existing) return existing;
  const token = crypto.randomBytes(24).toString("hex");
  savePlatformSettings({ syncToken: token } as Partial<PlatformSettings>);
  return token;
}

function getAgentStoreManifestDocs(image: string): Record<string, unknown>[] {
  const file = resolveDeployFile("deploy/openshift/agentstore.yaml");
  const docs = parseManifestDocs(file);

  const settings = getPlatformSettings();
  const routeUrl = settings.agentstoreDeploy?.routeUrl ?? "";
  const syncToken = getOrCreateSyncToken();

  // --- Build the seed ConfigMap + Secret ---------------------------------

  const seedConfigData: Record<string, string> = {
    "platform.json": JSON.stringify(seedPlatformSettings(settings), null, 2),
    "catalog-overrides.json": JSON.stringify(readCatalogOverrides(), null, 2),
    "deleted-listings.json": JSON.stringify(readDeletedListings(), null, 2),
    "providers.json": JSON.stringify(readProviders(), null, 2),
  };

  const customListings = readCustomListings();
  for (const [name, content] of Object.entries(customListings)) {
    seedConfigData[`custom-listing-${name}`] = content;
  }

  docs.push({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "agentstore-state-seed",
      namespace: AGENTSTORE_NAMESPACE,
      labels: { "app.kubernetes.io/managed-by": "agentstore" },
      annotations: { "agentstore.io/seed-timestamp": now() },
    },
    data: seedConfigData,
  });

  const decryptedSecrets = exportDecryptedSecrets();
  // K8s Secret keys only allow [-._a-zA-Z0-9].  Vault keys can contain
  // colons (e.g. "provider:openshift-ai-maas-verp:apiKey"), so encode
  // them for the Secret and decode on import in seedMerge.ts.
  const encodedSecrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(decryptedSecrets)) {
    encodedSecrets[key.replace(/:/g, "__COLON__")] = value;
  }

  docs.push({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "agentstore-secrets-seed",
      namespace: AGENTSTORE_NAMESPACE,
      labels: { "app.kubernetes.io/managed-by": "agentstore" },
    },
    stringData: encodedSecrets,
  });

  // --- Patch the Deployment: env vars + seed volume mounts ---------------

  for (const doc of docs) {
    if (doc.kind === "Deployment") {
      const spec = doc.spec as {
        template?: {
          spec?: {
            containers?: Array<{
              image?: string;
              env?: Array<{ name: string; value: string }>;
              volumeMounts?: Array<{ name: string; mountPath: string; readOnly?: boolean }>;
            }>;
            volumes?: Array<Record<string, unknown>>;
          };
        };
      } | undefined;

      const container = spec?.template?.spec?.containers?.[0];
      if (container) {
        container.image = image;

        const envList = container.env ?? [];
        if (routeUrl) {
          envList.push({ name: "AGENTSTORE_ROUTE_URL", value: routeUrl });
        }
        envList.push({ name: "AGENTSTORE_SYNC_TOKEN", value: syncToken });
        container.env = envList;

        const mounts = container.volumeMounts ?? [];
        mounts.push({ name: "seed-config", mountPath: "/app/.seed/config", readOnly: true });
        mounts.push({ name: "seed-secrets", mountPath: "/app/.seed/secrets", readOnly: true });
        container.volumeMounts = mounts;
      }

      const volumes = spec?.template?.spec?.volumes ?? [];
      volumes.push({
        name: "seed-config",
        configMap: { name: "agentstore-state-seed" },
      });
      volumes.push({
        name: "seed-secrets",
        secret: { secretName: "agentstore-secrets-seed" },
      });
      if (spec?.template?.spec) {
        spec.template.spec.volumes = volumes;
      }
    }
  }

  // All builds now live in the `agentstore` namespace, but agent pods run
  // in the workloads namespace (e.g. `agent-workloads`).  Grant the
  // workloads namespace's default ServiceAccount the system:image-puller
  // role in `agentstore` so agent pods can pull built images across
  // namespaces.
  const workloadsNs = openshiftNamespace();
  if (workloadsNs !== AGENTSTORE_NAMESPACE) {
    docs.push({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: {
        name: "workloads-image-puller",
        namespace: AGENTSTORE_NAMESPACE,
        labels: { "app.kubernetes.io/managed-by": "agentstore" },
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: "system:image-puller",
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: "default",
          namespace: workloadsNs,
        },
      ],
    });
  }

  return docs;
}

export async function startAgentStoreDeploy(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  if (!isOpenshiftConfigured()) {
    throw new Error("OpenShift is not configured — set the API URL and token in Admin → Platform.");
  }
  if (!settings.aapProjectGitUrl.trim()) {
    throw new Error(
      "Set a Project Git URL in the AAP Job Templates card above first — the OpenShift build uses that same repo/branch."
    );
  }

  try {
    await ensureNamespace(AGENTSTORE_NAMESPACE);
    const { buildName } = await startAgentStoreImageBuild({
      gitUrl: settings.aapProjectGitUrl,
      gitBranch: settings.aapProjectGitBranch || "main",
    });
    return persist({ status: "deploying", phase: "building", buildName, updatedAt: now() });
  } catch (err) {
    return persist({ status: "failed", error: err instanceof Error ? err.message : String(err), updatedAt: now() });
  }
}

export async function refreshAgentStoreDeploy(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  const deploy = settings.agentstoreDeploy;
  if (!deploy || deploy.status !== "deploying") {
    return settings;
  }

  try {
    let image = deploy.image;
    let ocpPhase = deploy.ocpPhase;

    if (!image) {
      if (!deploy.buildName) {
        throw new Error("AgentStore deploy has no build in flight to poll.");
      }
      ocpPhase = await getAgentStoreImageBuildPhase(deploy.buildName);
      const result = await getAgentStoreImageBuildResult(deploy.buildName);
      if (!result) {
        return persist({ ...deploy, phase: "building", ocpPhase, updatedAt: now() });
      }
      image = result.image;
    }

    // Re-apply manifests on every poll while deploying — they are
    // idempotent (PVCs skip update; other resources use resourceVersion)
    // and this ensures partial failures (e.g. a previous PVC 422 that
    // aborted before the RoleBinding was created) are recovered on the
    // next poll cycle.
    const docs = getAgentStoreManifestDocs(image);
    await applyAgentSandboxManifests(docs);
    const routeUrl = deploy.routeUrl
      || await getAgentSandboxServiceRouteHost(AGENTSTORE_NAMESPACE, AGENTSTORE_DEPLOY_NAME);

    const readiness = await getAgentSandboxServiceReadiness(AGENTSTORE_NAMESPACE, AGENTSTORE_DEPLOY_NAME);
    if (!readiness.ready) {
      if (readiness.stalledReason) {
        return persist({
          ...deploy,
          status: "failed",
          error: `Deployment rollout stalled: ${readiness.stalledReason}`,
          ocpPhase,
          image,
          routeUrl,
          updatedAt: now(),
        });
      }
      return persist({ ...deploy, phase: "waiting-for-rollout", ocpPhase, image, routeUrl, updatedAt: now() });
    }

    return persist({ status: "running", phase: "done", ocpPhase, image, routeUrl, updatedAt: now() });
  } catch (err) {
    return persist({
      ...deploy,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      updatedAt: now(),
    });
  }
}

export async function fetchAgentStoreDeployLog(): Promise<string> {
  ensurePlatformEnv();
  const deploy = getPlatformSettings().agentstoreDeploy;
  if (!deploy?.buildName) return "(no build started yet)";
  return getAgentStoreImageBuildLog(deploy.buildName);
}

// --- Sync state to cluster -----------------------------------------------

/** Gather local state and push it to the on-cluster AgentStore via
 *  POST /api/admin/sync.  Returns { ok, syncedAt } on success. */
export async function syncStateToCluster(): Promise<{ ok: boolean; syncedAt?: string; error?: string }> {
  const settings = getPlatformSettings();
  const routeUrl = settings.agentstoreDeploy?.routeUrl;
  const syncToken = settings.syncToken;

  if (!routeUrl) {
    return { ok: false, error: "AgentStore is not deployed — no Route URL available." };
  }
  if (!syncToken) {
    return { ok: false, error: "No sync token found — redeploy AgentStore to generate one." };
  }

  const payload = {
    platformSettings: seedPlatformSettings(settings),
    secrets: exportDecryptedSecrets(),
    catalogOverrides: readCatalogOverrides(),
    deletedListings: readDeletedListings(),
    providers: readProviders(),
    customListings: readCustomListings(),
  };

  try {
    const res = await fetch(`${routeUrl}/api/admin/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sync-Token": syncToken,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Sync failed (${res.status}): ${text.slice(0, 300)}` };
    }

    const result = (await res.json()) as { ok: boolean; syncedAt: string };
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
