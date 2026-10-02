import { NextResponse } from "next/server";
import { loadListings } from "@/server/catalog";
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
export async function GET() {
  const listings = loadListings().filter(
    (l) => l.reviewStatus === "published" || l.reviewStatus === "in-review",
  );

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
    - red-hat
spec:
  owner: group:default/platform-team`;

  const components = listings.map(listingToComponent);
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

function listingToComponent(listing: Listing): string {
  const tags = ["ai-agent", runtimeTag(listing)];
  if (listing.category) {
    tags.push(listing.category.toLowerCase().replace(/\s+/g, "-"));
  }

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
    agentstore.io/review-status: ${listing.reviewStatus}
spec:
  type: ai-agent
  lifecycle: ${listing.reviewStatus === "published" ? "production" : "experimental"}
  owner: group:default/${departmentToTeam(listing.department)}
  system: agentstore
`;
}
