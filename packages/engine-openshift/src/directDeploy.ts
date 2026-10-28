import type { AgentDeploymentStatus, OpenShellMcpServerConfig, ProviderKind, Skill } from "@agentstore/shared";
import { agentRuntimeImage as defaultAgentRuntimeImage, isOpenshiftConfigured, openshiftNamespace, standardLabels } from "./config";
import * as ocp from "./openshift";
import { createHash } from "node:crypto";

/**
 * Direct OpenShift deployment for generic-chat agents. Creates
 * Kubernetes resources (Secret, Deployment, Service, Route) via direct
 * OpenShift API calls.
 *
 * Resources created per agent (all in the configured namespace):
 *   - Secret `<deploymentName>-config` (env scalars + config.json)
 *   - Deployment `<deploymentName>` (agent-runtime container)
 *   - Service `<deploymentName>` (port 8080)
 *   - Route `<deploymentName>` (TLS edge termination)
 */

export interface DirectDeployInput {
  listingId: string;
  listingName: string;
  /** Stable per-listing resource name for the Deployment/Service/Route/
   * Secret (e.g. `agent-<shortid>`). */
  deploymentName: string;
  provider: {
    kind: ProviderKind;
    baseUrl?: string;
    defaultModel?: string;
    apiKey?: string;
  };
  introLines: string[];
  skills: Skill[];
  mcpServers: OpenShellMcpServerConfig[];
  agentRuntimeImage?: string;
}

export interface DirectDeployStatus {
  status: AgentDeploymentStatus;
  routeUrl?: string;
  error?: string;
}

/**
 * Creates/updates all Kubernetes resources for a generic-chat agent
 * deployment. Idempotent — safe to call again on redeploy.
 */
export async function launchDirectDeploy(input: DirectDeployInput): Promise<void> {
  if (!isOpenshiftConfigured()) {
    throw new Error("OpenShift API URL or token is not configured — set them in Admin → Platform.");
  }

  const ns = openshiftNamespace();
  const image = input.agentRuntimeImage || defaultAgentRuntimeImage();

  const configJson = JSON.stringify({
    listingName: input.listingName,
    introLines: input.introLines,
    skills: input.skills,
    mcpServers: input.mcpServers,
  });

  // Compute a config checksum to force pod rollouts on config changes
  // Config-checksum annotation forces pod rollout on config changes.
  const configChecksum = createHash("sha256")
    .update(configJson + input.provider.kind + (input.provider.baseUrl ?? "") + (input.provider.defaultModel ?? "") + (input.provider.apiKey ?? ""))
    .digest("hex");

  const agentLabels = standardLabels("agent-runtime", input.deploymentName, {
    "agentstore/listing-id": input.listingId,
  });

  // 1. Create/update the config Secret
  await ocp.applyResource(ns, "secrets", `${input.deploymentName}-config`, {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: `${input.deploymentName}-config`,
      namespace: ns,
      labels: agentLabels,
    },
    type: "Opaque",
    stringData: {
      LISTING_NAME: input.listingName,
      PROVIDER_KIND: input.provider.kind,
      PROVIDER_BASE_URL: input.provider.baseUrl ?? "",
      PROVIDER_DEFAULT_MODEL: input.provider.defaultModel ?? "",
      PROVIDER_API_KEY: input.provider.apiKey ?? "",
      "config.json": configJson,
    },
  });

  // Selector labels must be a stable subset — use component + listing-id
  const selectorLabels = {
    "app.kubernetes.io/component": "agent-runtime",
    "agentstore/listing-id": input.listingId,
  };

  // 2. Create/update the Deployment
  await ocp.applyResource(ns, "deployments", input.deploymentName, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: input.deploymentName,
      namespace: ns,
      labels: agentLabels,
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: selectorLabels,
      },
      template: {
        metadata: {
          labels: agentLabels,
          annotations: {
            "agentstore/config-checksum": configChecksum,
          },
        },
        spec: {
          containers: [
            {
              name: "agent-runtime",
              image,
              imagePullPolicy: "IfNotPresent",
              ports: [{ containerPort: 8080 }],
              envFrom: [{ secretRef: { name: `${input.deploymentName}-config` } }],
              volumeMounts: [
                { name: "config", mountPath: "/etc/agent", readOnly: true },
              ],
              readinessProbe: {
                httpGet: { path: "/health", port: 8080 },
                initialDelaySeconds: 3,
                periodSeconds: 5,
              },
              livenessProbe: {
                httpGet: { path: "/health", port: 8080 },
                initialDelaySeconds: 10,
                periodSeconds: 15,
              },
            },
          ],
          volumes: [
            {
              name: "config",
              secret: {
                secretName: `${input.deploymentName}-config`,
                items: [{ key: "config.json", path: "config.json" }],
              },
            },
          ],
        },
      },
    },
  });

  // 3. Create/update the Service
  await ocp.applyResource(ns, "services", input.deploymentName, {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: input.deploymentName,
      namespace: ns,
      labels: agentLabels,
    },
    spec: {
      selector: selectorLabels,
      ports: [{ name: "http", port: 8080, targetPort: 8080 }],
    },
  });

  // 4. Create/update the Route (TLS edge termination)
  await ocp.applyResource(ns, "routes", input.deploymentName, {
    apiVersion: "route.openshift.io/v1",
    kind: "Route",
    metadata: {
      name: input.deploymentName,
      namespace: ns,
      labels: agentLabels,
    },
    spec: {
      to: { kind: "Service", name: input.deploymentName },
      port: { targetPort: "http" },
      tls: {
        termination: "edge",
        insecureEdgeTerminationPolicy: "Redirect",
      },
    },
  });
}

/**
 * Polls the deployment status by checking the Deployment readiness and
 * Route host directly.
 */
export async function getDirectDeployStatus(
  deploymentName: string
): Promise<DirectDeployStatus> {
  if (!isOpenshiftConfigured()) {
    return { status: "failed", error: "OpenShift API is not configured." };
  }

  try {
    const ns = openshiftNamespace();

    // Check Deployment readiness
    const deployReady = await ocp.getDeploymentReadiness(ns, deploymentName);
    if (deployReady.stalledReason) {
      return { status: "failed", error: deployReady.stalledReason };
    }

    // Read Route host
    const routeHost = await ocp.getRouteHost(ns, deploymentName);

    if (deployReady.ready && routeHost) {
      return { status: "running", routeUrl: `https://${routeHost}` };
    }

    return { status: "deploying" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
