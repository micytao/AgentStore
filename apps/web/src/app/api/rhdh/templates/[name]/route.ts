import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { loadListings } from "@/server/catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/rhdh/templates/:name
 *
 * Serves a Backstage Software Template YAML file from the local
 * `rhdh/templates/{name}/template.yaml` directory.  RHDH registers
 * this URL as a `catalog.locations` entry (type: url, allow: Template)
 * so templates are discovered without needing a public GitHub repo.
 *
 * For the `deploy-agent` template, the listing ID field is dynamically
 * populated with real published agent IDs as a dropdown instead of
 * free text.
 *
 * Open access — template metadata is non-sensitive and RHDH's
 * location fetcher does not send custom headers.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  // Sanitise — allow only simple alphanumeric + dash names
  if (!/^[a-z0-9-]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid template name" }, { status: 400 });
  }

  const candidates = [
    path.resolve(process.cwd(), "../../rhdh/templates", name, "template.yaml"),
    path.resolve(process.cwd(), "rhdh/templates", name, "template.yaml"),
    path.resolve(__dirname, "../../../../../../rhdh/templates", name, "template.yaml"),
  ];

  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    return NextResponse.json(
      { error: `Template "${name}" not found` },
      { status: 404 },
    );
  }

  let yaml = fs.readFileSync(filePath, "utf8");

  // For the deploy-agent template, inject a real enum of published listing
  // IDs so RHDH renders a dropdown instead of a free-text field.
  if (name === "deploy-agent") {
    yaml = injectListingEnum(yaml);
  }

  return new NextResponse(yaml, {
    status: 200,
    headers: { "Content-Type": "text/yaml; charset=utf-8" },
  });
}

/**
 * Replaces the free-text `listingId` field with an enum dropdown
 * populated from the real published agent catalog.
 */
function injectListingEnum(yaml: string): string {
  const listings = loadListings().filter(
    (l) => l.reviewStatus === "published" || l.reviewStatus === "in-review",
  );
  if (listings.length === 0) return yaml;

  const enumEntries = listings.map((l) => `            - ${l.id}`).join("\n");
  const enumLabels = listings
    .map((l) => `              ${l.id}: "${l.name} (${l.runtime === "openshell" ? "collaborative" : "autonomous"})"`)
    .join("\n");

  const replacement = `        listingId:
          title: Agent listing ID
          type: string
          description: Select a published agent to deploy.
          enum:
${enumEntries}
          ui:enumNames:
${enumLabels}
          ui:autofocus: true`;

  return yaml.replace(
    /^ {8}listingId:\n(?:^ {10}.+\n)*/m,
    replacement + "\n",
  );
}
