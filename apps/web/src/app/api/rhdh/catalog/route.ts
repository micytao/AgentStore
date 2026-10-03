import { NextResponse } from "next/server";
import { loadListings } from "@/server/catalog";
import { getPlatformSettings } from "@/server/platform";
import type { Listing } from "@agentstore/shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/rhdh/catalog
 *
 * Returns a multi-document YAML response containing:
 *  - the "agentstore" System entity
 *  - one Backstage Component entity per published agent listing
 *
 * RHDH polls this URL as a `catalog.locations` entry (type: url) to
 * populate the Software Catalog with AgentStore agents — no static
 * YAML files or GitHub access required.
 *
 * Open access (no service-token check) because catalog metadata is
 * non-sensitive and RHDH's location fetcher does not send custom headers.
 */
export async function GET(request: Request) {
  const listings = loadListings().filter(
    (l) => l.reviewStatus === "published" || l.reviewStatus === "in-review",
  );

  // Resolve the external AgentStore URL for links end users click in RHDH.
  // On the deployed instance, AGENTSTORE_ROUTE_URL is injected by the
  // deploy manifest; locally, fall back to platform settings.  As a last
  // resort, derive it from the incoming request's origin (works when RHDH
  // fetches the catalog via the AgentStore Route/Service URL).
  const settings = getPlatformSettings();
  const agentStoreBaseUrl =
    process.env.AGENTSTORE_ROUTE_URL
    || settings.agentstoreDeploy?.routeUrl
    || deriveBaseUrl(request);

  const systemEntity = `apiVersion: backstage.io/v1alpha1
kind: System
metadata:
  name: agentstore
  title: Agent Store
  description: >-
    Governed AI agent catalog.  Agents are onboarded via AgentStore,
    provisioned by Ansible Automation Platform, and hosted on OpenShift.
  tags:
    - ai
    - agents
    - red-hat${agentStoreBaseUrl ? `\n  links:\n    - url: ${agentStoreBaseUrl}/catalog\n      title: Open AgentStore console` : ""}
spec:
  owner: group:default/platform-team`;

  const components = listings.map((l) => listingToComponent(l, agentStoreBaseUrl));
  const docs = [systemEntity, ...components].join("\n---\n");

  return new NextResponse(docs, {
    status: 200,
    headers: { "Content-Type": "text/yaml; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------------
// Helpers — same mapping logic as /api/rhdh/catalog-sync
// ---------------------------------------------------------------------------

function runtimeTag(listing: Listing): string {
  return listing.runtime === "openshell" ? "collaborative" : "autonomous";
}

function departmentToTeam(department: string): string {
  const map: Record<string, string> = {
    engineering: "engineering-team",
    security: "security-team",
    support: "support-team",
    data: "data-team",
    finance: "finance-team",
  };
  return map[department] ?? "platform-team";
}

function listingToComponent(listing: Listing, baseUrl: string): string {
  const tags = ["ai-agent", runtimeTag(listing)];
  if (listing.category) {
    tags.push(listing.category.toLowerCase().replace(/\s+/g, "-"));
  }

  // Build links section — "Open in AgentStore" always, plus the agent's
  // own chat/session URL if it has been deployed.
  const links: string[] = [];
  if (baseUrl) {
    links.push(`    - url: ${baseUrl}/catalog\n      title: Open in AgentStore`);
  }
  // Autonomous agents (generic-chat) have a direct route URL
  const agentUrl = listing.deployment?.routeUrl;
  if (agentUrl) {
    links.push(`    - url: ${agentUrl}\n      title: Launch Agent`);
  }
  // Collaborative agents (openshell) are accessed via AgentStore's listing page
  if (!agentUrl && listing.runtime === "openshell" && baseUrl) {
    links.push(`    - url: ${baseUrl}/listing/${listing.id}\n      title: Launch Agent`);
  }
  const linksBlock = links.length > 0
    ? `\n  links:\n${links.join("\n")}`
    : "";

  return `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${listing.id}
  title: "${listing.name}"
  description: "${listing.description.replace(/"/g, '\\"').replace(/\n/g, " ")}"
  tags:
${tags.map((t) => `    - ${t}`).join("\n")}
  annotations:
    agentstore.io/listing-id: ${listing.id}
    agentstore.io/runtime: ${listing.runtime ?? "generic-chat"}
    agentstore.io/risk-tier: ${listing.riskTier}
    agentstore.io/review-status: ${listing.reviewStatus}${linksBlock}
spec:
  type: ai-agent
  lifecycle: ${listing.reviewStatus === "published" ? "production" : "experimental"}
  owner: group:default/${departmentToTeam(listing.department)}
  system: agentstore
`;
}

/**
 * Derives the AgentStore base URL from the incoming request when no
 * explicit env var or setting is available.  RHDH fetches the catalog
 * via the AgentStore Route, so the request's origin gives us the
 * externally-reachable URL.
 */
function deriveBaseUrl(request: Request): string {
  try {
    const url = new URL(request.url);
    // request.url in Next.js may use the internal host (e.g. localhost:3000).
    // Prefer x-forwarded-host / x-forwarded-proto set by the OpenShift Route.
    const host = request.headers.get("x-forwarded-host") || url.host;
    const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
    return `${proto}://${host}`;
  } catch {
    return "";
  }
}
