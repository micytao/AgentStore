import fs from "node:fs";
import path from "node:path";
import type { RhdhDeployStatus, PlatformSettings } from "@agentstore/shared";
import {
  applyAgentSandboxManifests,
  applyBackstageCR,
  checkNamespaceDeploymentReadiness,
  checkRhdhOperator,
  getNamespaceRouteHost,
  isAapConfigured,
  isOpenshiftConfigured,
  pingAap,
  pingOpenshift,
  restartNamespaceDeployments,
} from "@agentstore/engine-ansible";
import { ensurePlatformEnv, getPlatformSettings, savePlatformSettings } from "./platform";
import { getSecret } from "./secrets";

/**
 * RHDH self-service portal install (Admin -> Self-service Portal).
 * Three operations:
 *
 *  1. Preflight — reads connection/deploy state, returns check results.
 *  2. Operator install — creates Namespace + OperatorGroup + Subscription
 *     in the `rhdh` namespace via the OpenShift API (not via AAP).
 *  3. Instance provision — creates ConfigMaps + Secret + Backstage CR in
 *     the `rhdh` namespace, then polls for the Route.
 *
 * Persists progress on PlatformSettings.rhdhDeploy.
 */

const RHDH_NAMESPACE = "rhdh";
const BACKSTAGE_NAME = "developer-hub";

function now(): string {
  return new Date().toISOString();
}

function persist(deploy: RhdhDeployStatus): PlatformSettings {
  return savePlatformSettings({ rhdhDeploy: deploy });
}

// --- Preflight -----------------------------------------------------------

export interface RhdhPreflightResult {
  aap: { status: "connected" | "disconnected" | "not-configured" };
  openshift: { status: "connected" | "disconnected" | "not-configured" };
  agentstoreOnCluster: { status: "running" | "not-deployed" | "failed" };
  rhdhOperator: { status: "installed" | "not-installed"; apiVersion?: string };
  rhdhInstance: { status: "running" | "not-deployed" | "deploying" | "failed" };
  serviceToken: { status: "set" | "not-set" };
  deploy?: RhdhDeployStatus;
}

export async function getRhdhPreflight(): Promise<RhdhPreflightResult> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();

  let aapStatus: "connected" | "disconnected" | "not-configured" = "not-configured";
  if (isAapConfigured()) {
    const ping = await pingAap();
    aapStatus = ping.ok ? "connected" : "disconnected";
  }

  let ocpStatus: "connected" | "disconnected" | "not-configured" = "not-configured";
  if (isOpenshiftConfigured()) {
    const ping = await pingOpenshift();
    ocpStatus = ping.ok ? "connected" : "disconnected";
  }

  // Live-check AgentStore on the cluster (if OCP is connected) instead of
  // relying solely on the local agentstoreDeploy setting, which may be stale
  // after a cluster reset or manual redeploy.
  let asStatus: "running" | "not-deployed" | "failed" = "not-deployed";
  if (ocpStatus === "connected") {
    try {
      const asReadiness = await checkNamespaceDeploymentReadiness("agentstore");
      if (asReadiness.ready) {
        asStatus = "running";
      } else if (settings.agentstoreDeploy?.status === "failed") {
        asStatus = "failed";
      }
    } catch {
      // Fall back to local settings if the live check fails
      asStatus = settings.agentstoreDeploy?.status === "running"
        ? "running"
        : settings.agentstoreDeploy?.status === "failed"
          ? "failed"
          : "not-deployed";
    }
  } else if (settings.agentstoreDeploy?.status) {
    asStatus = settings.agentstoreDeploy.status === "running"
      ? "running"
      : settings.agentstoreDeploy.status === "failed"
        ? "failed"
        : "not-deployed";
  }

  let operatorStatus: "installed" | "not-installed" = "not-installed";
  let operatorApiVersion: string | undefined;
  if (isOpenshiftConfigured()) {
    const check = await checkRhdhOperator();
    if (check.installed) {
      operatorStatus = "installed";
      operatorApiVersion = check.apiVersion;
    }
  }

  const rhdhDeploy = settings.rhdhDeploy;
  const instanceStatus = rhdhDeploy?.instanceStatus ?? "not-deployed";

  const token = getSecret("AGENTSTORE_SERVICE_TOKEN");
  const tokenStatus = token ? "set" : "not-set";

  return {
    aap: { status: aapStatus },
    openshift: { status: ocpStatus },
    agentstoreOnCluster: { status: asStatus },
    rhdhOperator: { status: operatorStatus, apiVersion: operatorApiVersion },
    rhdhInstance: { status: instanceStatus },
    serviceToken: { status: tokenStatus },
    deploy: rhdhDeploy,
  };
}

// --- Operator install ----------------------------------------------------

export async function installRhdhOperator(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  if (!isOpenshiftConfigured()) {
    throw new Error("OpenShift is not configured — set the API URL and token in Admin → Platform.");
  }

  const current = getPlatformSettings().rhdhDeploy ?? {
    operatorStatus: "not-installed" as const,
    instanceStatus: "not-deployed" as const,
  };

  try {
    const docs: Record<string, unknown>[] = [
      {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: {
          name: RHDH_NAMESPACE,
          labels: { "app.kubernetes.io/managed-by": "agentstore" },
        },
      },
      {
        apiVersion: "operators.coreos.com/v1",
        kind: "OperatorGroup",
        metadata: {
          name: "rhdh-operator-group",
          namespace: RHDH_NAMESPACE,
          labels: { "app.kubernetes.io/managed-by": "agentstore" },
        },
        spec: {},
      },
      {
        apiVersion: "operators.coreos.com/v1alpha1",
        kind: "Subscription",
        metadata: {
          name: "rhdh",
          namespace: RHDH_NAMESPACE,
          labels: { "app.kubernetes.io/managed-by": "agentstore" },
        },
        spec: {
          channel: "fast",
          name: "rhdh",
          source: "redhat-operators",
          sourceNamespace: "openshift-marketplace",
          installPlanApproval: "Automatic",
        },
      },
    ];

    await applyAgentSandboxManifests(docs);
    return persist({
      ...current,
      operatorStatus: "installing",
      updatedAt: now(),
    });
  } catch (err) {
    return persist({
      ...current,
      operatorStatus: "failed",
      error: err instanceof Error ? err.message : String(err),
      updatedAt: now(),
    });
  }
}

export async function refreshRhdhOperator(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  const deploy = settings.rhdhDeploy;
  if (!deploy || deploy.operatorStatus !== "installing") {
    return settings;
  }

  try {
    const check = await checkRhdhOperator();
    if (check.installed) {
      return persist({ ...deploy, operatorStatus: "installed", updatedAt: now() });
    }
    return settings;
  } catch (err) {
    return persist({
      ...deploy,
      operatorStatus: "failed",
      error: err instanceof Error ? err.message : String(err),
      updatedAt: now(),
    });
  }
}

// --- Instance provision --------------------------------------------------

export interface RhdhInstanceInput {
  namespace?: string;
  agentstoreUrl?: string;
}

function resolveRhdhFile(relativePath: string): string {
  const candidates = [
    path.resolve(process.cwd(), "../../", relativePath),
    path.resolve(process.cwd(), relativePath),
    path.resolve(__dirname, "../../../../", relativePath),
  ];
  return candidates.find((file) => fs.existsSync(file)) ?? candidates[0];
}

export async function provisionRhdhInstance(input: RhdhInstanceInput = {}): Promise<PlatformSettings> {
  ensurePlatformEnv();
  if (!isOpenshiftConfigured()) {
    throw new Error("OpenShift is not configured.");
  }

  const ns = input.namespace || RHDH_NAMESPACE;
  const settings = getPlatformSettings();
  const agentstoreUrl = input.agentstoreUrl
    || settings.agentstoreDeploy?.routeUrl
    || "http://agentstore.agentstore.svc:3000/api";
  const serviceToken = getSecret("AGENTSTORE_SERVICE_TOKEN") || "";
  const gitUrl = settings.aapProjectGitUrl || "https://github.com/YOUR_ORG/AgentStore";
  const gitBranch = settings.aapProjectGitBranch || "main";

  const current = settings.rhdhDeploy ?? {
    operatorStatus: "installed" as const,
    instanceStatus: "not-deployed" as const,
  };

  try {
    let appConfigData = "";
    const snippetPath = resolveRhdhFile("rhdh/app-config-snippet.yaml");
    if (fs.existsSync(snippetPath)) {
      appConfigData = fs.readFileSync(snippetPath, "utf8");
    } else {
      appConfigData = buildDefaultAppConfig(agentstoreUrl, gitUrl, gitBranch);
    }
    appConfigData = appConfigData
      .replace(/\$\{AGENTSTORE_URL\}/g, agentstoreUrl)
      .replace(/\$\{AGENTSTORE_SERVICE_TOKEN\}/g, serviceToken)
      .replace(/YOUR_ORG\/AgentStore/g, extractRepoPath(gitUrl))
      .replace(/CLUSTER_DOMAIN/g, extractClusterDomain(settings));

    let dynamicPluginsData = "";
    const pluginsPath = resolveRhdhFile("rhdh/dynamic-plugins.yaml");
    if (fs.existsSync(pluginsPath)) {
      dynamicPluginsData = fs.readFileSync(pluginsPath, "utf8");
    } else {
      dynamicPluginsData = buildDefaultDynamicPlugins();
    }

    const docs: Record<string, unknown>[] = [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: {
          name: "agentstore-rhdh-app-config",
          namespace: ns,
          labels: { "app.kubernetes.io/managed-by": "agentstore" },
        },
        data: { "app-config.yaml": appConfigData },
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: {
          name: "agentstore-rhdh-dynamic-plugins",
          namespace: ns,
          labels: { "app.kubernetes.io/managed-by": "agentstore" },
        },
        data: { "dynamic-plugins.yaml": dynamicPluginsData },
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: "rhdh-secrets",
          namespace: ns,
          labels: { "app.kubernetes.io/managed-by": "agentstore" },
        },
        stringData: {
          AGENTSTORE_URL: agentstoreUrl,
          AGENTSTORE_SERVICE_TOKEN: serviceToken,
        },
      },
    ];

    await applyAgentSandboxManifests(docs);

    // Discover the correct Backstage CR API version from the cluster
    // (varies across RHDH operator releases) and apply it separately.
    const operatorCheck = await checkRhdhOperator();
    if (!operatorCheck.installed || !operatorCheck.apiVersion) {
      throw new Error("RHDH operator not found on the cluster — install it first.");
    }

    await applyBackstageCR(ns, BACKSTAGE_NAME, operatorCheck.apiVersion, {
      application: {
        appConfig: {
          configMaps: [{ name: "agentstore-rhdh-app-config" }],
        },
        dynamicPluginsConfigMapName: "agentstore-rhdh-dynamic-plugins",
        extraEnvs: {
          secrets: [{ name: "rhdh-secrets" }],
        },
        route: { enabled: true },
      },
    });

    // Restart existing RHDH pods so they pick up updated ConfigMaps/Secrets.
    // On a fresh deploy the operator creates new pods anyway; on a re-deploy
    // this ensures config changes take effect without manual intervention.
    await restartNamespaceDeployments(ns);

    return persist({
      ...current,
      instanceStatus: "deploying",
      updatedAt: now(),
    });
  } catch (err) {
    return persist({
      ...current,
      instanceStatus: "failed",
      error: err instanceof Error ? err.message : String(err),
      updatedAt: now(),
    });
  }
}

export async function refreshRhdhInstance(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  const deploy = settings.rhdhDeploy;
  if (!deploy || deploy.instanceStatus !== "deploying") {
    return settings;
  }

  try {
    const rawRouteUrl = await getNamespaceRouteHost(RHDH_NAMESPACE);
    // RHDH has no home page at "/"; append /catalog so links land correctly
    const routeUrl = rawRouteUrl ? `${rawRouteUrl}/catalog` : undefined;
    const readiness = await checkNamespaceDeploymentReadiness(RHDH_NAMESPACE);

    if (readiness.ready && routeUrl) {
      return persist({
        ...deploy,
        instanceStatus: "running",
        routeUrl,
        updatedAt: now(),
      });
    }

    if (readiness.stalledReason) {
      return persist({
        ...deploy,
        instanceStatus: "failed",
        error: `RHDH rollout stalled: ${readiness.stalledReason}`,
        routeUrl,
        updatedAt: now(),
      });
    }

    // Still waiting — update routeUrl if discovered
    return persist({ ...deploy, routeUrl, updatedAt: now() });
  } catch {
    return settings;
  }
}

// --- Helpers -------------------------------------------------------------

function extractClusterDomain(settings: PlatformSettings): string {
  const consoleUrl = settings.openshiftConsoleUrl || "";
  const match = consoleUrl.match(/console-openshift-console\.(apps\..+)/);
  if (match) return match[1];
  const apiUrl = settings.openshiftApiUrl || "";
  const apiMatch = apiUrl.match(/api\.(.*?)(?::6443)?$/);
  if (apiMatch) return `apps.${apiMatch[1]}`;
  return "apps.cluster.example.com";
}

function extractRepoPath(gitUrl: string): string {
  const match = gitUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
  return match ? match[1] : "YOUR_ORG/AgentStore";
}

function buildDefaultAppConfig(agentstoreUrl: string, _gitUrl: string, _gitBranch: string): string {
  return `app:
  title: Agent Store - Self-Service Portal
proxy:
  endpoints:
    '/agentstore':
      target: ${agentstoreUrl}
      changeOrigin: true
      headers:
        X-AgentStore-Token: \${AGENTSTORE_SERVICE_TOKEN}
auth:
  environment: development
  providers:
    guest:
      dangerouslyAllowOutsideDevelopment: true
catalog:
  rules:
    - allow: [Component, Template, System, Group, Resource, Location]
`;
}

function buildDefaultDynamicPlugins(): string {
  return `includes:
  - dynamic-plugins.default.yaml
plugins:
  - package: './dynamic-plugins/dist/roadiehq-scaffolder-backend-module-http-request-dynamic'
    disabled: false
`;
}
