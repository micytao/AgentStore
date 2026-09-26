import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { invalidateSkillsCache } from "./skills";

/**
 * Live version of scripts/import-redhat-skills.ts — same source (Red Hat's
 * real Agentic Skill Packs on GitHub), same output shape
 * (catalog/skills/<pack>/<id>.json), but callable from an Admin button
 * instead of a build-time CLI script, so pulling in a new/updated pack is a
 * demo click. This is the change that makes the Skills tab feel like a
 * live "manager" rather than a static, pre-baked catalog.
 *
 * Unlike the CLI script (which wipes and rewrites the entire catalog/skills
 * directory every run), this only touches the specific pack(s) requested,
 * so a partial/failed import can't wipe packs the admin didn't ask about.
 */

const REPO = "RHEcosystemAppEng/agentic-plugins";
const BRANCH = "main";
const API_BASE = `https://api.github.com/repos/${REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

export const RED_HAT_SKILL_PACKS = [
  "rh-basic",
  "rh-sre",
  "rh-developer",
  "rh-virt",
  "ocp-admin",
  "rh-ai-engineer",
  "rh-automation",
] as const;

export type RedHatSkillPack = (typeof RED_HAT_SKILL_PACKS)[number];

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

function builtinSkillsDir(): string {
  // Mirrors skills.ts's builtinDir() resolution exactly — must write to the
  // same directory that process reads built-in skills from.
  if (process.env.SKILLS_CATALOG_DIR) return process.env.SKILLS_CATALOG_DIR;
  const candidates = [
    path.resolve(process.cwd(), "../../catalog/skills"),
    path.resolve(process.cwd(), "catalog/skills"),
    path.resolve(__dirname, "../../../../catalog/skills"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
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

function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { frontmatter: {}, body: raw.trim() };
  const [, fmBlock, body] = match;
  const frontmatter = (yaml.load(fmBlock) as Record<string, unknown>) ?? {};
  return { frontmatter, body: body.trim() };
}

const ACRONYMS = new Set(["ai", "vm", "rhel", "scc", "rbac", "nim", "s2i", "ds", "aap", "ocp", "cve", "mcp"]);

function titleCaseFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

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
  const firstLine = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
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
    let raw: string;
    try {
      raw = await fetchRaw(`${pack}/skills/${slug}/SKILL.md`);
    } catch {
      continue;
    }
    const { frontmatter, body } = splitFrontmatter(raw);
    skills.push({ pack, slug, frontmatter, body });
  }
  return skills;
}

export interface ImportResult {
  packs: string[];
  written: number;
  errors: { pack: string; error: string }[];
}

/** Imports one or more Red Hat Agentic Skill Packs live, writing into the
 * same catalog/skills/<pack>/ directory the CLI script does, then
 * invalidates skills.ts's in-memory cache so the new skills are picked up
 * by the very next request — no restart required. */
export async function importRedHatSkillPacks(
  packs: readonly string[] = RED_HAT_SKILL_PACKS
): Promise<ImportResult> {
  const outDir = builtinSkillsDir();
  let written = 0;
  const errors: { pack: string; error: string }[] = [];

  for (const pack of packs) {
    try {
      const raw = await fetchPackSkills(pack);
      const slugCounts = new Map<string, number>();
      for (const s of raw) slugCounts.set(s.slug, (slugCounts.get(s.slug) ?? 0) + 1);

      const packDir = path.join(outDir, pack);
      fs.mkdirSync(packDir, { recursive: true });
      // Clear only this pack's directory before rewriting it, so a skill
      // renamed/removed upstream doesn't linger as a stale file.
      for (const file of fs.readdirSync(packDir).filter((f) => f.endsWith(".json"))) {
        fs.rmSync(path.join(packDir, file));
      }

      for (const skill of raw) {
        const id = (slugCounts.get(skill.slug) ?? 0) > 1 ? `${skill.pack}-${skill.slug}` : skill.slug;
        const name = displayNameFor(skill.slug, skill.body);
        const description = descriptionFrom(skill.frontmatter, skill.slug);
        const allowedTools = allowedToolsFrom(skill.frontmatter);
        const instructions = /^#\s+/.test(skill.body) ? skill.body : `# ${name}\n\n${skill.body}`;
        fs.writeFileSync(
          path.join(packDir, `${id}.json`),
          JSON.stringify({ id, name, description, instructions, pack, allowedTools }, null, 2) + "\n"
        );
        written += 1;
      }
    } catch (err) {
      errors.push({ pack, error: err instanceof Error ? err.message : String(err) });
    }
  }

  invalidateSkillsCache();
  return { packs: [...packs], written, errors };
}
