import type { AgentDeployment, Listing } from "@agentstore/shared";
import { departmentLabel } from "@agentstore/shared";
import {
  aapDefaultJobTemplateId,
  genericAgentDeploymentName,
  getGenericAgentDeployStatus,
  isAapConfigured,
  launchGenericAgentDeploy,
  openshiftNamespace,
} from "@agentstore/engine-ansible";
import { getListing, updateListing } from "./catalog";
import { providerFor } from "./drafting";
import { mcpServersFor } from "./orchestrator";
import { ensurePlatformEnv } from "./platform";
import { apiKeyFor } from "./providers";
import { getSkillsByIds } from "./skills";

/**
 * The `generic-chat` runtime's "deploy once" admin action: launches
 * ansible/provision-generic-agent.yml via AAP and persists progress onto
 * the listing's `deployment` field (via catalog.ts's existing
 * agentConfig-override mechanism), so every user just opens the resulting
 * `routeUrl` — no per-Task provisioning, unlike orchestrator.ts's
 * createTask()/adapterFor() path for `hosted-agent-api`/`openshell`.
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
 * Launches (or re-launches, e.g. after a failure) the AAP job that deploys
 * this listing's generic-chat agent. Persists an initial "deploying"
 * AgentDeployment immediately and returns; the Admin UI polls
 * refreshDeployment() for progress, the same inline-progress pattern
 * TaskDetailPage.tsx already uses for Task provisioning.
 */
export async function startDeployment(listingId: string): Promise<Listing> {
  ensurePlatformEnv();
  const listing = getListing(listingId);
  if (!listing) throw new Error(`Unknown listing: ${listingId}`);
  if (listing.runtime !== "generic-chat") {
    throw new Error(`"${listing.name}" is not a generic-chat runtime listing.`);
  }
  if (!isAapConfigured()) {
    throw new Error("AAP is not configured — set the controller URL and token in Admin → Platform.");
  }

  const templateId = listing.agentConfig?.aapJobTemplateId ?? aapDefaultJobTemplateId();
  if (!templateId) {
    throw new Error(
      "No AAP job template configured for this deploy. Set one on this listing (Agent config → AAP job template), or a Platform default — it must launch provision-generic-agent.yml, not the one-shot playbook."
    );
  }

  const provider = providerFor(listing);
  if (!provider) {
    throw new Error(
      "No model provider is configured for this listing. Bind one under Agent config, or set a global active provider in Admin → LLMs."
    );
  }

  const deploymentName = genericAgentDeploymentName(listing.id);
  const { aapJobId, aapJobUrl } = await launchGenericAgentDeploy({
    listingId: listing.id,
    listingName: listing.name,
    deploymentName,
    jobTemplateId: templateId,
    provider: {
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      apiKey: apiKeyFor(provider.id),
    },
    introLines: chatIntroLinesFor(listing),
    skills: getSkillsByIds(listing.agentConfig?.skillIds),
    mcpServers: mcpServersFor(listing),
  });

  return persistDeployment(listingId, {
    status: "deploying",
    aapJobId,
    aapJobUrl,
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
  if (!deployment || deployment.status !== "deploying" || !deployment.aapJobId || !deployment.openshiftDeploymentName) {
    return listing;
  }

  const result = await getGenericAgentDeployStatus(deployment.aapJobId, deployment.openshiftDeploymentName);
  return persistDeployment(listingId, {
    ...deployment,
    status: result.status,
    routeUrl: result.routeUrl ?? deployment.routeUrl,
    error: result.error,
    updatedAt: now(),
  });
}
