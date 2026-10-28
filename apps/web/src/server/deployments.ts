import type { AgentDeployment, Listing } from "@agentstore/shared";
import { departmentLabel } from "@agentstore/shared";
import {
  deleteGenericAgentDeployment,
  genericAgentDeploymentName,
  getDirectDeployStatus,
  isOpenshiftConfigured,
  launchDirectDeploy,
  openshiftNamespace,
} from "@agentstore/engine-openshift";
import { getListing, updateListing } from "./catalog";
import { mcpServersFor } from "./agentRuntimeConfig";
import { ensurePlatformEnv, getPlatformSettings } from "./platform";
import { apiKeyFor, providerFor } from "./providers";
import { getSkillsByIds } from "./skills";

/**
 * The `generic-chat` runtime's "deploy once" admin action: launches a
 * direct OpenShift deployment and persists progress onto the listing's
 * `deployment` field, so every admin just opens the resulting `routeUrl`
 * — a one-time, per-listing action, not something re-provisioned per visit.
 */

function now(): string {
  return new Date().toISOString();
}

/** Persona intro for the deployed chat agent — distinct from
 * drafting.ts's introLinesFor(), which frames the agent as producing a
 * one-shot draft for review; this agent talks to users directly, turn
 * after turn. */
function chatIntroLinesFor(listing: Listing): string[] {
  return [
    `You are the AI agent behind the "${listing.name}" listing in AgentStore's ${departmentLabel(listing.department)} department.`,
    listing.description,
    "You are running as a persistent chat assistant that users talk to directly, turn by turn. Respond helpfully and conversationally, and use tools when they help answer the request.",
  ];
}

function persistDeployment(id: string, deployment: AgentDeployment): Listing {
  const updated = updateListing(id, { deployment });
  if (!updated) throw new Error(`Unknown listing: ${id}`);
  return updated;
}

/**
 * Launches (or re-launches, e.g. after a failure) the direct OpenShift
 * deployment for this listing's generic-chat agent. Persists an initial
 * "deploying" AgentDeployment immediately and returns; the Admin UI polls
 * refreshDeployment() for progress.
 */
export async function startDeployment(listingId: string): Promise<Listing> {
  ensurePlatformEnv();
  const listing = getListing(listingId);
  if (!listing) throw new Error(`Unknown listing: ${listingId}`);
  if (listing.runtime !== "generic-chat") {
    throw new Error(`"${listing.name}" is not a generic-chat runtime listing.`);
  }
  if (!isOpenshiftConfigured()) {
    throw new Error("OpenShift is not configured — set the API URL and token in Admin → Platform.");
  }

  const provider = providerFor(listing);
  if (!provider) {
    throw new Error(
      "No model provider is configured for this listing. Bind one under Agent config, or set a global active provider in Admin → LLMs."
    );
  }

  const deploymentName = genericAgentDeploymentName(listing.id);
  await launchDirectDeploy({
    listingId: listing.id,
    listingName: listing.name,
    deploymentName,
    provider: {
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      apiKey: apiKeyFor(provider.id),
    },
    introLines: chatIntroLinesFor(listing),
    skills: getSkillsByIds(listing.agentConfig?.skillIds),
    mcpServers: mcpServersFor(listing),
    agentRuntimeImage: getPlatformSettings().agentRuntimeImage,
  });

  return persistDeployment(listingId, {
    status: "deploying",
    openshiftDeploymentName: deploymentName,
    namespace: openshiftNamespace(),
    updatedAt: now(),
  });
}

/**
 * Polls the in-flight deploy (if any) and updates the persisted
 * AgentDeployment. A no-op that just returns the listing unchanged when
 * there's nothing in flight (no deployment yet, or already
 * running/failed) — safe for the Admin UI to call on an interval.
 */
export async function refreshDeployment(listingId: string): Promise<Listing> {
  ensurePlatformEnv();
  const listing = getListing(listingId);
  if (!listing) throw new Error(`Unknown listing: ${listingId}`);

  const deployment = listing.deployment;
  if (!deployment || deployment.status !== "deploying" || !deployment.openshiftDeploymentName) {
    return listing;
  }

  const result = await getDirectDeployStatus(deployment.openshiftDeploymentName);
  return persistDeployment(listingId, {
    ...deployment,
    status: result.status,
    routeUrl: result.routeUrl ?? deployment.routeUrl,
    error: result.error,
    updatedAt: now(),
  });
}

/**
 * Tears down this listing's generic-chat deployment (Deployment/Service/
 * Route/Secret/result-ConfigMap — see deleteGenericAgentDeployment()),
 * e.g. an admin explicitly stopping a running agent, or cleaning up after
 * a failed deploy that left partial resources behind. Mirrors
 * openshellDeploy.ts's stopOpenShellSession() — resets to a plain
 * "not-deployed" state afterwards, so "Deploy to OpenShift" reappears and
 * a follow-up deploy starts completely fresh.
 */
export async function stopDeployment(listingId: string): Promise<Listing> {
  ensurePlatformEnv();
  const listing = getListing(listingId);
  if (!listing) throw new Error(`Unknown listing: ${listingId}`);
  if (listing.runtime !== "generic-chat") {
    throw new Error(`"${listing.name}" is not a generic-chat runtime listing.`);
  }

  const deploymentName = listing.deployment?.openshiftDeploymentName ?? genericAgentDeploymentName(listing.id);
  await deleteGenericAgentDeployment(deploymentName);
  return persistDeployment(listingId, { status: "not-deployed", updatedAt: now() });
}
