import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { AgentSandboxControllerStatus, AgentSandboxServiceInstallStatus, PlatformSettings } from "@agentstore/shared";
import {
  applyAgentSandboxManifests,
  checkAgentSandboxController,
  ensureSecretValue,
  findOrCreateAgentSandboxServiceTokenSecret,
  getAgentSandboxServiceImageBuildPhase,
  getAgentSandboxServiceImageBuildResult,
  getAgentSandboxServiceReadiness,
  getAgentSandboxServiceRouteHost,
  isOpenshiftConfigured,
  openshiftNamespace,
  restartAgentSandboxServiceDeployment,
  startAgentSandboxServiceImageBuild,
} from "@agentstore/engine-ansible";
import { ensurePlatformEnv, getPlatformSettings, savePlatformSettings } from "./platform";
import { getSecret, setSecret } from "./secrets";

/**
 * AgentStore-side wiring around packages/engine-ansible's openshift.ts
 * Agent Sandbox controller functions, for the Admin -> LLMs -> OpenShell
 * tab's live preflight check + "Install Agent Sandbox controller"
 * button. Unlike the gateway Helm install or the EE/Agent Runtime image
 * builds, there's no long-running external process to poll here: the
 * REST calls that create the CRD/ClusterRole/Deployment etc. return as
 * soon as the Kubernetes API server accepts them, so this is a plain
 * synchronous request/response — nothing persisted to PlatformSettings.
 * The OpenShell tab re-checks status on every page load (via
 * apps/web/src/server/platform.ts's probeOpenshift()) and can poll
 * checkAgentSandboxStatus() for a few seconds after a successful install
 * while the CRD finishes becoming "Established" and the controller pod
 * starts.
 *
 * This file also wires the separate "Install Agent Sandbox Service"
 * admin action — apps/agent-sandbox-service is AgentStore's *own*
 * microservice (no public image), so that one genuinely does need a
 * two-phase build-then-deploy flow (like eeBuild.ts/agentRuntimeBuild.ts),
 * persisted onto PlatformSettings.agentSandboxServiceInstall so the
 * Admin UI can poll it across requests the same way it polls those.
 *
 * Note: imports getPlatformSettings/savePlatformSettings/ensurePlatformEnv
 * from ./platform, so ./platform must NOT import anything from this file
 * (it calls checkAgentSandboxController() from @agentstore/engine-ansible
 * directly instead) — see the comment in platform.ts explaining why.
 */

function now(): string {
  return new Date().toISOString();
}

/** Resolves a deploy/openshift/*.yaml file's absolute path, trying (in
 * order) an explicit env override, `cwd` as apps/web, `cwd` as the repo
 * root, and a `__dirname`-relative fallback — same three-candidate
 * pattern as catalog.ts/skillsImport.ts, generalized here since two
 * different vendored manifests (controller + service) both need it. */
function resolveDeployFile(relativePath: string, envOverride?: string): string {
  if (envOverride) return envOverride;
  const candidates = [
    path.resolve(process.cwd(), "../../", relativePath),
    path.resolve(process.cwd(), relativePath),
    path.resolve(__dirname, "../../../../", relativePath),
  ];
  return candidates.find((file) => fs.existsSync(file)) ?? candidates[0];
}

function parseManifestDocs(file: string, describeWhenMissing: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) {
    throw new Error(`${describeWhenMissing} not found at ${file}.`);
  }
  const raw = fs.readFileSync(file, "utf8");
  const docs = yaml.loadAll(raw) as unknown[];
  return docs.filter((doc): doc is Record<string, unknown> => !!doc && typeof doc === "object");
}

// --- Agent Sandbox controller (live preflight + install) --------------

function controllerManifestPath(): string {
  return resolveDeployFile("deploy/openshift/agent-sandbox-crds.yaml", process.env.AGENT_SANDBOX_MANIFEST_PATH);
}

/** Parses the vendored deploy/openshift/agent-sandbox-crds.yaml (a
 * pinned copy of kubernetes-sigs/agent-sandbox's release manifest) into
 * one JS object per YAML document, in file order — same `js-yaml`
 * dependency and `yaml.load`-style usage as catalog.ts, just
 * `loadAll()` since this is a multi-document file. */
function getAgentSandboxManifestDocs(): Record<string, unknown>[] {
  return parseManifestDocs(
    controllerManifestPath(),
    "Agent Sandbox controller manifest not found — expected deploy/openshift/agent-sandbox-crds.yaml"
  );
}

/** Live "installed/missing" check — thin wrapper so both platform.ts's
 * probeOpenshift() and the polling GET route can share one entry point. */
export async function checkAgentSandboxStatus(): Promise<AgentSandboxControllerStatus> {
  return checkAgentSandboxController();
}

/** Applies the vendored Agent Sandbox controller manifest via the
 * OpenShift API, using the same OPENSHIFT_TOKEN already configured for
 * everything else on the OpenShell tab. Throws (with a specific,
 * actionable message — see applyAgentSandboxManifests()'s doc comment)
 * if that token lacks the cluster-admin-equivalent RBAC this needs; the
 * caller (the POST route) surfaces that error to the Admin UI verbatim,
 * which points back at the manual `oc apply` fallback in
 * deploy/openshift/README.md section 5a. */
export async function installAgentSandboxController(): Promise<{
  applied: string[];
  status: AgentSandboxControllerStatus;
}> {
  const docs = getAgentSandboxManifestDocs();
  const { applied } = await applyAgentSandboxManifests(docs);
  // Re-check immediately so the response already reflects fresh state
  // where possible — the CRD is typically served within a second or two
  // of being created, but the Admin UI still polls checkAgentSandboxStatus()
  // afterward in case it isn't quite ready yet.
  const status = await checkAgentSandboxController();
  return { applied, status };
}

// --- Agent Sandbox Service (build from source + deploy) ---------------

const AGENT_SANDBOX_SERVICE_NAME = "agent-sandbox-service";
const AGENT_SANDBOX_SERVICE_TOKEN_SECRET_NAME = "agent-sandbox-service-token";
const AGENT_SANDBOX_SERVICE_TOKEN_SECRET_KEY = "OPENSHELL_SERVICE_TOKEN";

function serviceManifestPath(): string {
  return resolveDeployFile(
    "deploy/openshift/agent-sandbox-service.yaml",
    process.env.AGENT_SANDBOX_SERVICE_MANIFEST_PATH
  );
}

/** Parses deploy/openshift/agent-sandbox-service.yaml and patches every
 * document's namespace to whatever OPENSHIFT_NAMESPACE is actually
 * configured (the vendored file hardcodes `agent-workloads`, which is
 * only the *default* — deploying into a namespace the admin didn't ask
 * for would be a surprising thing for a button to do silently), and the
 * Deployment's container image to the just-built one.
 *
 * Also prepends a bare `ServiceAccount` doc for whatever name the
 * Deployment's `spec.template.spec.serviceAccountName` references (e.g.
 * `agentstore-console`) if the manifest doesn't already define one
 * itself. The vendored file only *references* that ServiceAccount —
 * it's actually created by deploy/openshift/agent-workloads.yaml's
 * separate, manual "Step 1" `oc apply`, per the README. On a cluster
 * where that step was skipped, the Deployment's ReplicaSet rejects pod
 * creation outright ("serviceaccount ... not found") — no pod, no
 * image pull, no readiness probe, ever — which otherwise looks
 * identical to a plain slow rollout from getAgentSandboxServiceReadiness()'s
 * point of view. Creating a bare ServiceAccount here (no RBAC) is
 * sufficient: apps/agent-sandbox-service's own code never calls the
 * Kubernetes API, so this identity only needs to exist, not have any
 * particular permissions. */
function getAgentSandboxServiceManifestDocs(image: string, namespace: string): Record<string, unknown>[] {
  const docs = parseManifestDocs(
    serviceManifestPath(),
    "Agent Sandbox Service manifest not found — expected deploy/openshift/agent-sandbox-service.yaml"
  );
  const referencedServiceAccounts = new Set<string>();
  const definedServiceAccounts = new Set<string>();
  for (const doc of docs) {
    if (doc.metadata && typeof doc.metadata === "object") {
      doc.metadata = { ...(doc.metadata as Record<string, unknown>), namespace };
    }
    if (doc.kind === "ServiceAccount" && typeof (doc.metadata as { name?: string } | undefined)?.name === "string") {
      definedServiceAccounts.add((doc.metadata as { name: string }).name);
    }
    if (doc.kind === "Deployment") {
      const spec = doc.spec as
        | { template?: { spec?: { containers?: Array<{ image?: string }>; serviceAccountName?: string } } }
        | undefined;
      const container = spec?.template?.spec?.containers?.[0];
      if (!container) {
        throw new Error("agent-sandbox-service.yaml's Deployment has no spec.template.spec.containers[0] to set the image on.");
      }
      container.image = image;
      const saName = spec?.template?.spec?.serviceAccountName;
      if (saName) referencedServiceAccounts.add(saName);
    }
  }
  const missingServiceAccountDocs: Record<string, unknown>[] = [...referencedServiceAccounts]
    .filter((name) => !definedServiceAccounts.has(name))
    .map((name) => ({
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name, namespace, labels: { "app.kubernetes.io/managed-by": "agentstore" } },
    }));

  // Images are built in the `agentstore` namespace. If this service
  // deploys into a different namespace, grant its SAs pull access.
  const imagePullerDocs: Record<string, unknown>[] = [];
  if (namespace !== "agentstore") {
    // Grant every SA the Deployment references (e.g. "agentstore-console")
    // plus "default" as a fallback.
    const pullSubjects = new Set(["default", ...referencedServiceAccounts]);
    imagePullerDocs.push({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: {
        name: "workloads-image-puller",
        namespace: "agentstore",
        labels: { "app.kubernetes.io/managed-by": "agentstore" },
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: "system:image-puller",
      },
      subjects: [...pullSubjects].map((sa) => ({
        kind: "ServiceAccount",
        name: sa,
        namespace,
      })),
    });
  }

  return [...imagePullerDocs, ...missingServiceAccountDocs, ...docs];
}

function persistServiceInstall(
  install: AgentSandboxServiceInstallStatus,
  extra?: Partial<PlatformSettings>
): PlatformSettings {
  return savePlatformSettings({ ...extra, agentSandboxServiceInstall: install });
}

/**
 * Starts (or re-starts) the "Install Agent Sandbox Service" action's
 * OpenShift Build — apps/agent-sandbox-service has no public pre-built
 * image, so this is phase 1 of 2 (see refreshAgentSandboxServiceInstall()
 * for phase 2: applying the Deployment/Service/Route once the image is
 * ready). Persists an initial "deploying"/"building" status immediately
 * and returns; the Admin UI polls refreshAgentSandboxServiceInstall()
 * for progress — same two-phase convention as eeBuild.ts/
 * agentRuntimeBuild.ts.
 */
export async function startAgentSandboxServiceInstall(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  if (!isOpenshiftConfigured()) {
    throw new Error("OpenShift is not configured — set the API URL and token in Admin → Platform.");
  }
  if (!settings.aapProjectGitUrl.trim()) {
    throw new Error(
      "Set a Project Git URL in the AAP Job Templates card (Admin → Platform) first — the OpenShift build uses that same repo/branch."
    );
  }
  try {
    // Push the user's GitHub Packages token into a Kubernetes Secret so the
    // BuildConfig can reference it as a build env var for npm install.
    const githubToken = getSecret("GITHUB_PACKAGES_TOKEN");
    if (githubToken) {
      await ensureSecretValue("agentstore", "github-packages-token", "GITHUB_TOKEN", githubToken);
    }
    const { buildName } = await startAgentSandboxServiceImageBuild({
      gitUrl: settings.aapProjectGitUrl,
      gitBranch: settings.aapProjectGitBranch || "main",
      githubPackagesSecretName: githubToken ? "github-packages-token" : undefined,
    });
    return persistServiceInstall({ status: "deploying", phase: "building", buildName, updatedAt: now() });
  } catch (err) {
    return persistServiceInstall({ status: "failed", error: err instanceof Error ? err.message : String(err), updatedAt: now() });
  }
}

/**
 * Polls the in-flight build/install (if any) and updates the persisted
 * `agentSandboxServiceInstall`. A no-op that just returns the settings
 * unchanged when there's nothing in flight — safe for the Admin UI to
 * call on an interval.
 *
 * Two phases, tracked by whether `image` is set yet:
 *  1. "building" — polls the OpenShift Build (same as
 *     refreshAgentRuntimeBuild()) until it completes.
 *  2. "waiting-for-rollout" — once there's an image, applies the
 *     Deployment/Service/Route + finds-or-creates the token Secret
 *     (idempotent — only actually done once, gated on `routeUrl` not
 *     being set yet, since re-PUTting the same spec every ~4s while
 *     waiting for the pod to become Ready is unnecessary churn), mirrors
 *     the token into AgentStore's own secrets vault and the Route's URL
 *     onto PlatformSettings.openshellServiceUrl, then just re-checks
 *     Deployment readiness each subsequent poll until it flips to
 *     "running". If that readiness check ever comes back with a
 *     `stalledReason` (a real failure condition, not just "still
 *     rolling out") this gives the Deployment exactly one automatic
 *     restart nudge — see restartAgentSandboxServiceDeployment() — and
 *     if it's *still* stalled after that, gives up and reports status
 *     "failed" with that reason, rather than leaving the Admin UI
 *     showing "waiting for pod rollout…" forever.
 */
export async function refreshAgentSandboxServiceInstall(): Promise<PlatformSettings> {
  ensurePlatformEnv();
  const settings = getPlatformSettings();
  const install = settings.agentSandboxServiceInstall;
  if (!install || install.status !== "deploying") {
    return settings;
  }

  try {
    let image = install.image;
    let ocpPhase = install.ocpPhase;
    if (!image) {
      if (!install.buildName) {
        throw new Error("Agent Sandbox Service install has no build in flight to poll.");
      }
      ocpPhase = await getAgentSandboxServiceImageBuildPhase(install.buildName);
      const result = await getAgentSandboxServiceImageBuildResult(install.buildName);
      if (!result) {
        // Build is still New/Pending/Running — nothing more to do this poll.
        return persistServiceInstall({ ...install, phase: "building", ocpPhase, updatedAt: now() });
      }
      image = result.image;
    }

    const namespace = openshiftNamespace();
    let routeUrl = install.routeUrl;
    if (!routeUrl) {
      const { token } = await findOrCreateAgentSandboxServiceTokenSecret(
        namespace,
        AGENT_SANDBOX_SERVICE_TOKEN_SECRET_NAME,
        AGENT_SANDBOX_SERVICE_TOKEN_SECRET_KEY
      );
      // Sync AgentStore's own vault to whatever the k8s Secret actually
      // holds (source of truth is what's mounted into the pod) — safe
      // to call even if this token already matched.
      setSecret("OPENSHELL_SERVICE_TOKEN", token);
      const docs = getAgentSandboxServiceManifestDocs(image, namespace);
      await applyAgentSandboxManifests(docs);
      routeUrl = await getAgentSandboxServiceRouteHost(namespace, AGENT_SANDBOX_SERVICE_NAME);
    }

    const readiness = await getAgentSandboxServiceReadiness(namespace, AGENT_SANDBOX_SERVICE_NAME);
    if (!readiness.ready) {
      if (readiness.stalledReason) {
        // A genuinely stuck rollout (e.g. "serviceaccount ... not found"),
        // not just a slow one — getAgentSandboxServiceManifestDocs() now
        // creates that ServiceAccount as part of every apply, but the
        // Deployment/ReplicaSet controller was already backed off from an
        // earlier failed attempt and won't necessarily retry on its own
        // schedule right away. Give it exactly one automatic
        // `rollout restart`-equivalent nudge, then — if it's *still*
        // stalled on the next poll after that — stop pretending this is
        // "waiting" and surface the real error instead of spinning
        // forever.
        if (!install.restartNudgedAt) {
          await restartAgentSandboxServiceDeployment(namespace, AGENT_SANDBOX_SERVICE_NAME);
          return persistServiceInstall(
            {
              ...install,
              phase: "waiting-for-rollout",
              ocpPhase,
              image,
              routeUrl,
              restartNudgedAt: now(),
              updatedAt: now(),
            },
            routeUrl ? { openshellServiceUrl: routeUrl } : undefined
          );
        }
        return persistServiceInstall({
          ...install,
          status: "failed",
          error: `Deployment rollout stalled: ${readiness.stalledReason}`,
          ocpPhase,
          image,
          routeUrl,
          updatedAt: now(),
        });
      }
      return persistServiceInstall(
        { ...install, phase: "waiting-for-rollout", ocpPhase, image, routeUrl, updatedAt: now() },
        routeUrl ? { openshellServiceUrl: routeUrl } : undefined
      );
    }

    return persistServiceInstall(
      { status: "running", phase: "done", ocpPhase, image, routeUrl, updatedAt: now() },
      routeUrl ? { openshellServiceUrl: routeUrl } : undefined
    );
  } catch (err) {
    return persistServiceInstall({
      ...install,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      updatedAt: now(),
    });
  }
}
