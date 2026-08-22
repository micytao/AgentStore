import fs from "node:fs";
import path from "node:path";
import type { Skill } from "@agentstore/shared";

/**
 * Real, file-backed skills library — same pattern as providers.ts/mcp.ts
 * (a JSON file under .data/, no external service). A skill is a reusable
 * instruction bundle an admin authors once and attaches to any number of
 * agents; its `instructions` are merged into that agent's system prompt by
 * drafting.ts.
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

function configFilePath(): string {
  return path.join(dataDir(), "skills.json");
}

function store(): { skills: Skill[] } {
  const g = globalThis as typeof globalThis & { __agentStoreSkills?: { skills: Skill[] } };
  if (!g.__agentStoreSkills) {
    g.__agentStoreSkills = { skills: readConfigFile() };
  }
  return g.__agentStoreSkills;
}

function readConfigFile(): Skill[] {
  const file = configFilePath();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Skill[];
  } catch {
    return [];
  }
}

function writeConfigFile(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFilePath(), JSON.stringify(store().skills, null, 2));
}

export function listSkills(): Skill[] {
  return [...store().skills].sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkill(id: string): Skill | undefined {
  return store().skills.find((s) => s.id === id);
}

export function getSkillsByIds(ids: string[] | undefined): Skill[] {
  if (!ids || ids.length === 0) return [];
  const found = ids.map((id) => getSkill(id)).filter((s): s is Skill => Boolean(s));
  return found;
}

export function upsertSkill(input: Skill): Skill {
  const skills = store().skills;
  const existing = skills.find((s) => s.id === input.id);
  if (existing) {
    Object.assign(existing, input);
  } else {
    skills.push(input);
  }
  writeConfigFile();
  return input;
}

export function deleteSkill(id: string): void {
  const skills = store().skills;
  const idx = skills.findIndex((s) => s.id === id);
  if (idx >= 0) skills.splice(idx, 1);
  writeConfigFile();
}
