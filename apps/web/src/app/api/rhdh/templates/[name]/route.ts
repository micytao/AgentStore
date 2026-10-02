import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/rhdh/templates/:name
 *
 * Serves a Backstage Software Template YAML file from the local
 * `rhdh/templates/{name}/template.yaml` directory.  RHDH registers
 * this URL as a `catalog.locations` entry (type: url, allow: Template)
 * so templates are discovered without needing a public GitHub repo.
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

  const yaml = fs.readFileSync(filePath, "utf8");
  return new NextResponse(yaml, {
    status: 200,
    headers: { "Content-Type": "text/yaml; charset=utf-8" },
  });
}
