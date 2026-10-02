import { NextResponse } from "next/server";
import { requireServiceToken } from "@/server/auth";
import { loadListings } from "@/server/catalog";
import type { Listing } from "@agentstore/shared";

/** Opt out of Next.js static caching — this route reads live catalog state. */
export const dynamic = "force-dynamic";

/**
 * GET /api/rhdh/catalog-sync
 *
 * Returns a multi-document YAML response containing one Backstage
 * catalog-info Component entity per published agent listing.  RHDH can
 * poll this URL as a catalog.locations entry (type: url) to auto-discover
 * agents without static YAML files.
 *
 * Guarded by the X-AgentStore-Token header when AGENTSTORE_SERVICE_TOKEN
 * is configured; open access otherwise (demo mode).
 */
export async function GET(request: Request) {
  const denied = requireServiceToken(request);
  if (denied) return denied;

  const listings = loadListings().filter(
    (l) => l.reviewStatus === "published" || l.reviewStatus === "in-review"
  );

  if (listings.length === 0) {
    return new NextResponse("# No published agents\n", {
      status: 200,
      headers: { "Content-Type": "text/yaml; charset=utf-8" },
    });
  }

  const docs = listings.map(listingToComponent).join("\n---\n");

  return new NextResponse(docs, {
    status: 200,
    headers: { "Content-Type": "text/yaml; charset=utf-8" },
  });
}

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
