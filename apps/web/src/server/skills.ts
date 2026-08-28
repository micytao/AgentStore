import fs from "node:fs";
import path from "node:path";
import type { Skill } from "@agentstore/shared";

/**
 * Two skill sources are merged, same "built-in vs custom" split as
 * catalog.ts uses for listings:
 *  - `catalog/skills/<pack>/*.json` — git-tracked, shipped Red Hat skill
 *    packs (see scripts/import-redhat-skills.ts). Read-only: loaded once
 *    per process, never written back to, so no network access is needed
 *    at runtime or demo time.
 *  - a writable `.data/skills.json` — skills authored by hand through the
 *    Admin Skills panel. Real file-backed CRUD, same pattern as
 *    providers.ts/mcp.ts.
 * A skill's `instructions` are merged into an agent's system prompt (via
 * agent-core's progressive-disclosure `load_skill` mechanism).
 */

function dataDir(): string {
  if (process.env.SECRETS_DATA_DIR) return process.env.SECRETS_DATA_DIR;
  const candidates = [
    path.resolve(process.cwd(), ".data"),
    path.resolve(process.cwd(), "../../.data"),
    path.resolve(__dirname, "../../../../.data"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

function builtinDir(): string {
  if (process.env.SKILLS_CATALOG_DIR) return process.env.SKILLS_CATALOG_DIR;
  const candidates = [
    path.resolve(process.cwd(), "../../catalog/skills"),
    path.resolve(process.cwd(), "catalog/skills"),
    path.resolve(__dirname, "../../../../catalog/skills"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

function configFilePath(): string {
  return path.join(dataDir(), "skills.json");
}

interface SkillStore {
  custom: Skill[];
  builtin: Skill[];
}

function store(): SkillStore {
  const g = globalThis as typeof globalThis & { __agentStoreSkills?: SkillStore };
  if (!g.__agentStoreSkills) {
    g.__agentStoreSkills = { custom: readConfigFile(), builtin: loadBuiltinSkills() };
  }
  return g.__agentStoreSkills;
}

function readConfigFile(): Skill[] {
  const file = configFilePath();
  if (!fs.existsSync(file)) return [];
  try {
    const skills = JSON.parse(fs.readFileSync(file, "utf8")) as Skill[];
    return skills.map((s) => ({ ...s, source: "custom" as const }));
  } catch {
    return [];
  }
}

/** Recursively walks catalog/skills/<pack>/*.json — one file per skill,
 * written by scripts/import-redhat-skills.ts. Missing directory just means
 * the importer hasn't been run yet; not a hard error. */
function loadBuiltinSkills(): Skill[] {
  const root = builtinDir();
  if (!fs.existsSync(root)) return [];
  const out: Skill[] = [];
  for (const packDir of fs.readdirSync(root)) {
    const fullPackDir = path.join(root, packDir);
    if (!fs.statSync(fullPackDir).isDirectory()) continue;
    for (const file of fs.readdirSync(fullPackDir).filter((f) => f.endsWith(".json"))) {
      try {
        const skill = JSON.parse(fs.readFileSync(path.join(fullPackDir, file), "utf8")) as Skill;
        out.push({ ...skill, source: "built-in" });
      } catch {
        // Skip malformed files rather than failing the whole catalog load.
      }
    }
  }
  return out;
}

function writeConfigFile(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const persisted = store().custom.map(({ source: _source, ...rest }) => rest);
  fs.writeFileSync(configFilePath(), JSON.stringify(persisted, null, 2));
}

export function listSkills(): Skill[] {
  return [...store().builtin, ...store().custom].sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkill(id: string): Skill | undefined {
  const { custom, builtin } = store();
  return custom.find((s) => s.id === id) ?? builtin.find((s) => s.id === id);
}

export function getSkillsByIds(ids: string[] | undefined): Skill[] {
  if (!ids || ids.length === 0) return [];
  const found = ids.map((id) => getSkill(id)).filter((s): s is Skill => Boolean(s));
  return found;
}

export function upsertSkill(input: Skill): Skill {
  if (store().builtin.some((s) => s.id === input.id)) {
    throw new Error(`"${input.id}" is a built-in Red Hat skill and cannot be edited`);
  }
  const skills = store().custom;
  const existing = skills.find((s) => s.id === input.id);
  const withSource: Skill = { ...input, source: "custom" };
  if (existing) {
    Object.assign(existing, withSource);
  } else {
    skills.push(withSource);
  }
  writeConfigFile();
  return withSource;
}

export function deleteSkill(id: string): void {
  if (store().builtin.some((s) => s.id === id)) {
    throw new Error(`"${id}" is a built-in Red Hat skill and cannot be deleted`);
  }
  const skills = store().custom;
  const idx = skills.findIndex((s) => s.id === id);
  if (idx >= 0) skills.splice(idx, 1);
  writeConfigFile();
}
