import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { AgentStoreDeployStatus, PlatformSettings } from "@agentstore/shared";
import {
  applyAgentSandboxManifests,
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

function getAgentStoreManifestDocs(image: string): Record<string, unknown>[] {
  const file = resolveDeployFile("deploy/openshift/agentstore.yaml");
  const docs = parseManifestDocs(file);
  for (const doc of docs) {
    if (doc.kind === "Deployment") {
      const spec = doc.spec as
        | { template?: { spec?: { containers?: Array<{ image?: string }> } } }
        | undefined;
      const container = spec?.template?.spec?.containers?.[0];
      if (container) {
        container.image = image;
      }
    }
  }

  // The image lives in the build namespace (e.g. agent-workloads) but the
  // Deployment runs in `agentstore`. Grant the agentstore namespace's
  // default ServiceAccount the system:image-puller role in the build
  // namespace so it can pull across namespaces.
  const buildNs = openshiftNamespace();
  if (buildNs !== AGENTSTORE_NAMESPACE) {
    docs.push({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: {
        name: "agentstore-image-puller",
        namespace: buildNs,
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
          namespace: AGENTSTORE_NAMESPACE,
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
