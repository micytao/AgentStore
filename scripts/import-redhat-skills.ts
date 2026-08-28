/**
 * One-time (re-runnable) importer that pulls Red Hat's real Agentic Skill
 * Packs from github.com/RHEcosystemAppEng/agentic-plugins and writes them
 * into catalog/skills/<pack>/<id>.json, in the same shape as this repo's
 * `Skill` type (packages/shared/src/index.ts). skills.ts then loads that
 * directory as built-in skills, so the shipped catalog needs no network
 * access at runtime or demo time — this script is a build-time/dev-time
 * tool, run by hand (`npm run import-redhat-skills`), not part of the app.
 *
 * Each pack's skills live at `<pack>/skills/<skill-dir>/SKILL.md` — plain
 * markdown with YAML frontmatter (name/description/allowed-tools/...),
 * the exact shape this repo's own installed Claude skills already use
 * (see .claude/skills/red-hat-*), which is how we know the format lines up
 * with the `Skill` model without any translation beyond frontmatter parsing.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const REPO = "RHEcosystemAppEng/agentic-plugins";
const BRANCH = "main";
const API_BASE = `https://api.github.com/repos/${REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

// The 7 real Agentic Skill Packs. `.claude/skills/**` also exists in the
// repo but holds meta skills for developing packs, not catalog content.
const PACKS = [
  "rh-basic",
  "rh-sre",
  "rh-developer",
  "rh-virt",
  "ocp-admin",
  "rh-ai-engineer",
  "rh-automation",
] as const;

const OUT_DIR = path.resolve(__dirname, "../catalog/skills");

interface GithubContentEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

interface RawSkill {
  pack: string;
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

async function ghFetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "agentstore-import-redhat-skills",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${url} -> ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function fetchRaw(pathname: string): Promise<string> {
  const url = `${RAW_BASE}/${pathname}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`raw.githubusercontent.com ${pathname} -> ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function listSkillDirs(pack: string): Promise<string[]> {
  const entries = await ghFetchJson<GithubContentEntry[]>(`${API_BASE}/contents/${pack}/skills?ref=${BRANCH}`);
  return entries.filter((e) => e.type === "dir").map((e) => e.name);
}

/** Splits `---\nfrontmatter\n---\nbody` into parsed frontmatter + raw body. */
function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { frontmatter: {}, body: raw.trim() };
  const [, fmBlock, body] = match;
  const frontmatter = (yaml.load(fmBlock) as Record<string, unknown>) ?? {};
  return { frontmatter, body: body.trim() };
}

// Slugs carry these as all-lowercase words, but they're acronyms/initialisms
// in normal writing — preserve their casing when title-casing a slug rather
// than rendering e.g. "Ai Observability" or "Vm Create".
const ACRONYMS = new Set([
  "ai",
  "vm",
  "rhel",
  "scc",
  "rbac",
  "nim",
  "s2i",
  "ds",
  "aap",
  "ocp",
  "cve",
  "mcp",
]);

function titleCaseFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/** Prefers the SKILL.md's first H1 heading (human-authored display name,
 * e.g. "CVE Impact Analysis Skill") over the frontmatter `name` (a
 * machine slug, e.g. "cve-impact") — falls back to a title-cased slug if
 * there's no heading at all, or if the heading is itself just a
 * slash-command invocation (e.g. "# /ai-observability Skill" in the
 * rh-ai-engineer/rh-developer/rh-virt packs) with no real casing/spacing
 * to preserve. */
function displayNameFor(slug: string, body: string): string {
  const heading = /^#\s+(.+)$/m.exec(body);
  if (heading) {
    const cleaned = heading[1].trim().replace(/\s+Skill$/i, "");
    if (!cleaned.startsWith("/")) return cleaned;
  }
  return titleCaseFromSlug(slug);
}

function descriptionFrom(frontmatter: Record<string, unknown>, slug: string): string {
  const raw = frontmatter.description;
  if (typeof raw !== "string") return titleCaseFromSlug(slug);
  // Multi-line YAML block descriptions (many rh-sre/rh-virt skills use `description: |`)
  // are meant for the model reading the menu, not a single-line UI label — collapse to
  // the first non-empty line for the Skill.description field (menu/list display), the
  // full text stays available inline at the top of `instructions`.
  const firstLine = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return firstLine ?? titleCaseFromSlug(slug);
}

function allowedToolsFrom(frontmatter: Record<string, unknown>): string[] | undefined {
  const raw = frontmatter["allowed-tools"];
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  return raw.trim().split(/\s+/);
}

async function fetchPackSkills(pack: string): Promise<RawSkill[]> {
  const dirs = await listSkillDirs(pack);
  const skills: RawSkill[] = [];
  for (const slug of dirs) {
    // Some packs' `skills/` directory also holds non-skill helper folders
    // (e.g. rh-ai-engineer/skills/references) with no SKILL.md — skip those
    // rather than failing the whole import.
    let raw: string;
    try {
      raw = await fetchRaw(`${pack}/skills/${slug}/SKILL.md`);
    } catch {
      console.log(`    skipping ${pack}/skills/${slug} (no SKILL.md)`);
      continue;
    }
    const { frontmatter, body } = splitFrontmatter(raw);
    skills.push({ pack, slug, frontmatter, body });
  }
  return skills;
}

function main(): Promise<void> {
  return (async () => {
    console.log(`Importing Red Hat Agentic Skill Packs from ${REPO}@${BRANCH}...`);

    const allByPack: RawSkill[][] = [];
    for (const pack of PACKS) {
      console.log(`  fetching ${pack}...`);
      allByPack.push(await fetchPackSkills(pack));
    }
    const all = allByPack.flat();

    // Skill directory names are unique within a pack but not always across
    // packs (e.g. both rh-sre and rh-automation ship an "execution-summary"
    // skill) — disambiguate only the colliding ones by prefixing the pack,
    // so ids stay short and readable everywhere else.
    const slugCounts = new Map<string, number>();
    for (const s of all) slugCounts.set(s.slug, (slugCounts.get(s.slug) ?? 0) + 1);

    if (fs.existsSync(OUT_DIR)) {
      fs.rmSync(OUT_DIR, { recursive: true });
    }

    let written = 0;
    for (const skill of all) {
      const id = (slugCounts.get(skill.slug) ?? 0) > 1 ? `${skill.pack}-${skill.slug}` : skill.slug;
      const name = displayNameFor(skill.slug, skill.body);
      const description = descriptionFrom(skill.frontmatter, skill.slug);
      const allowedTools = allowedToolsFrom(skill.frontmatter);
      // Most SKILL.md bodies already open with their own H1; only add one
      // if the body doesn't already have it, to avoid a duplicate heading.
      const instructions = /^#\s+/.test(skill.body) ? skill.body : `# ${name}\n\n${skill.body}`;

      const packDir = path.join(OUT_DIR, skill.pack);
      fs.mkdirSync(packDir, { recursive: true });
      const outFile = path.join(packDir, `${id}.json`);
      fs.writeFileSync(
        outFile,
        JSON.stringify(
          { id, name, description, instructions, pack: skill.pack, allowedTools },
          null,
          2
        ) + "\n"
      );
      written += 1;
    }

    console.log(`Wrote ${written} skills across ${PACKS.length} packs to ${path.relative(process.cwd(), OUT_DIR)}/`);
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
