import type { ModelTool, Skill } from "@agentstore/shared";

/**
 * Progressive-disclosure skills mechanics: instead of dumping every bound
 * skill's full `instructions` into the system prompt every turn, the model
 * sees a short name+description menu and calls the synthetic `load_skill`
 * tool to pull a skill's full body into context on demand. This is shared
 * by drafting.ts's one-shot loop and apps/agent-runtime's multi-turn loop
 * via chatLoop.ts.
 */

export const LOAD_SKILL_TOOL_NAME = "load_skill";

/** Synthetic tool — handled locally by chatLoop.ts, never forwarded to any
 * MCP server. Always offered to the model whenever the listing has at
 * least one bound skill. */
export const LOAD_SKILL_TOOL: ModelTool = {
  serverId: "__agent-core__",
  name: LOAD_SKILL_TOOL_NAME,
  description:
    "Load the full instructions for a specific skill by id when its description matches the current request. Call this before following a skill's workflow — its name+description alone are not enough to act on.",
  inputSchema: {
    type: "object",
    properties: {
      skill_id: {
        type: "string",
        description: "The id of the skill to load, taken from the skills menu in the system prompt.",
      },
    },
    required: ["skill_id"],
  },
};

/** Menu text listing each bound skill's id/name/description — this is what
 * actually sits in the system prompt, instead of every skill's full body. */
export function skillsMenu(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.id}: ${s.name} — ${s.description}`);
  return [
    `Skills available. Call the "${LOAD_SKILL_TOOL_NAME}" tool with a skill's id when its description matches the current request; its full instructions will then be loaded into context. If more than one skill looks relevant, call "${LOAD_SKILL_TOOL_NAME}" once per skill IN THE SAME RESPONSE (multiple tool calls in parallel) rather than one at a time across separate turns — each turn you spend only loading skills is one turn less available to actually answer.`,
    lines.join("\n"),
  ].join("\n");
}

/** Persona intro lines + the skills menu, joined the same way
 * drafting.ts's old systemPromptFor() joined its parts. */
export function buildSystemPrompt(introLines: string[], skills: Skill[]): string {
  const parts = [...introLines];
  const menu = skillsMenu(skills);
  if (menu) parts.push(menu);
  return parts.join("\n\n");
}

/**
 * Tool visibility for a given turn: a bound MCP tool that no skill claims
 * via `allowedTools` is always visible (keeps MCP-only listings, with no
 * skills at all, working exactly as before). A tool claimed by at least one
 * skill's `allowedTools` is only visible once one of those claiming skills
 * is in `activeSkillIds`.
 */
export function visibleTools(
  allTools: ModelTool[],
  skills: Skill[],
  activeSkillIds: ReadonlySet<string>
): ModelTool[] {
  const claimedBy = new Map<string, string[]>();
  for (const skill of skills) {
    for (const toolName of skill.allowedTools ?? []) {
      const owners = claimedBy.get(toolName) ?? [];
      owners.push(skill.id);
      claimedBy.set(toolName, owners);
    }
  }
  return allTools.filter((tool) => {
    const owners = claimedBy.get(tool.name);
    if (!owners || owners.length === 0) return true;
    return owners.some((skillId) => activeSkillIds.has(skillId));
  });
}

export function findSkill(skills: Skill[], skillId: string): Skill | undefined {
  return skills.find((s) => s.id === skillId);
}
