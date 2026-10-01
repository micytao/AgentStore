import type { ModelMessage, ModelToolCall, ModelTool, Skill } from "@agentstore/shared";
import type { CallOptions } from "./providers";
import { LOAD_SKILL_TOOL, LOAD_SKILL_TOOL_NAME, buildSystemPrompt, findSkill, visibleTools } from "./skills";

/**
 * The tool-hop loop, extracted from apps/web/src/server/drafting.ts's
 * generateDraft() and generalized to operate on a persisted ChatState
 * instead of always starting from one goal string — reused as-is for
 * drafting.ts's one-shot Autonomous drafts (fresh state per call) and for
 * apps/agent-runtime's real multi-turn chat (state persisted in a session
 * store across requests).
 */

/**
 * Each MCP tool call and the final text-producing call are separate "hops"
 * (one LLM round trip each). Skill loads via the synthetic `load_skill`
 * tool are "free" — they don't count against this limit because they're
 * resolved locally with no external cost, and some models stubbornly load
 * skills one at a time rather than batching parallel calls, which would
 * otherwise exhaust the budget before the model ever answers.
 */
const DEFAULT_MAX_HOPS = 8;

/** Returned by `runTurn` when `maxHops` is exhausted before the model
 * produces final text — exported so callers can detect this specific
 * outcome (e.g. to log a warning) instead of treating it like any other
 * successful reply. */
export const HOP_LIMIT_FALLBACK_MESSAGE =
  "The model reached the tool-call limit without producing a final answer. Try rephrasing or narrowing the request.";

export interface ChatState {
  messages: ModelMessage[];
  activeSkillIds: Set<string>;
}

export function createChatState(): ChatState {
  return { messages: [], activeSkillIds: new Set() };
}

export interface ChatDeps {
  callProvider: (opts: CallOptions) => Promise<{ text?: string; toolCalls?: ModelToolCall[] }>;
  callTool: (serverId: string, name: string, args: Record<string, unknown>) => Promise<string>;
  /** Optional streaming counterpart of `callProvider` — only used when the
   * caller also passes `onEvent` (see RunTurnOptions). Falls back to
   * `callProvider` otherwise, so drafting.ts's one-shot calls (which pass
   * neither) are unaffected. */
  streamProvider?: (
    opts: CallOptions,
    onDelta: (text: string) => void
  ) => Promise<{ text?: string; toolCalls?: ModelToolCall[] }>;
}

/** Live progress emitted mid-turn when `RunTurnOptions.onEvent` is set — lets
 * a caller (apps/agent-runtime's /api/chat) forward assistant text to the
 * user as it's generated, plus a heads-up whenever a tool hop starts,
 * instead of the caller blocking silently until the whole turn resolves. */
export type TurnEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; name: string }
  | { type: "tool_result"; name: string; result: string };

export interface RunTurnOptions {
  maxHops?: number;
  onEvent?: (event: TurnEvent) => void;
}

/**
 * Runs one user turn to completion: appends the user message, loops through
 * up to `maxHops` tool exchanges (including the synthetic `load_skill`
 * tool, resolved locally rather than forwarded to `deps.callTool`), and
 * returns the final assistant text. Mutates `state` in place so the caller
 * can persist it (or just discard it, for one-shot use).
 */
export async function runTurn(
  deps: ChatDeps,
  introLines: string[],
  skills: Skill[],
  tools: ModelTool[],
  state: ChatState,
  userMessage: string,
  opts?: RunTurnOptions
): Promise<string> {
  const maxHops = opts?.maxHops ?? DEFAULT_MAX_HOPS;
  const onEvent = opts?.onEvent;
  const systemPrompt = buildSystemPrompt(introLines, skills);
  state.messages.push({ role: "user", content: userMessage });

  // Skill-only rounds are free (don't increment `hop`), but we cap them
  // separately so a misbehaving model can't loop forever loading skills.
  const maxSkillOnlyRounds = skills.length + 4;
  let skillOnlyRounds = 0;

  // Cache visibleTools — only recompute when activeSkillIds changes.
  let cachedSkillCount = state.activeSkillIds.size;
  let cachedScopedTools = visibleTools(tools, skills, state.activeSkillIds);

  for (let hop = 0; hop < maxHops; ) {
    if (state.activeSkillIds.size !== cachedSkillCount) {
      cachedScopedTools = visibleTools(tools, skills, state.activeSkillIds);
      cachedSkillCount = state.activeSkillIds.size;
    }
    const toolsForModel = skills.length > 0
      ? [...cachedScopedTools, LOAD_SKILL_TOOL]
      : cachedScopedTools;
    const callOpts: CallOptions = {
      system: systemPrompt,
      messages: state.messages,
      tools: toolsForModel,
    };

    const response =
      deps.streamProvider && onEvent
        ? await deps.streamProvider(callOpts, (text) => onEvent({ type: "delta", text }))
        : await deps.callProvider(callOpts);

    if (response.toolCalls && response.toolCalls.length > 0) {
      // Separate skill loads (local, sync) from real MCP tool calls so we
      // can resolve skills first (they may unlock MCP tools via allowedTools)
      // and then dispatch all real MCP calls in parallel.
      const skillCalls: ModelToolCall[] = [];
      const mcpCalls: ModelToolCall[] = [];
      for (const call of response.toolCalls) {
        onEvent?.({ type: "tool_call", name: call.name });
        if (call.name === LOAD_SKILL_TOOL_NAME) {
          skillCalls.push(call);
        } else {
          mcpCalls.push(call);
        }
      }

      // Resolve skill loads first (local, no network).
      for (const call of skillCalls) {
        const skillId = String((call.args as Record<string, unknown> | undefined)?.skill_id ?? "");
        const skill = findSkill(skills, skillId);
        let result: string;
        if (skill && state.activeSkillIds.has(skill.id)) {
          result = `Skill "${skill.name}" is already loaded — its instructions are already in context above. Do NOT call load_skill for this skill again. Proceed to answer the user's question using the instructions you already have.`;
        } else if (skill) {
          result = `Skill "${skill.name}" loaded:\n${skill.instructions}`;
        } else {
          result = `No skill found with id "${skillId}". Available ids: ${skills.map((s) => s.id).join(", ")}`;
        }
        if (skill) state.activeSkillIds.add(skill.id);
        state.messages.push({ role: "tool", toolName: call.name, content: result });
        onEvent?.({ type: "tool_result", name: call.name, result: skill ? `Loaded skill: ${skill.name}` : result });
      }

      // Dispatch real MCP tool calls in parallel (latency = max, not sum).
      if (mcpCalls.length > 0) {
        const results = await Promise.all(
          mcpCalls.map(async (call) => {
            try {
              return await deps.callTool(call.serverId, call.name, call.args);
            } catch (err) {
              return `Tool call failed: ${err instanceof Error ? err.message : String(err)}`;
            }
          })
        );
        for (let i = 0; i < mcpCalls.length; i++) {
          const call = mcpCalls[i];
          const result = results[i];
          state.messages.push({
            role: "tool",
            toolName: call.name,
            content: `Result of ${call.name}(${JSON.stringify(call.args)}):\n${result}`,
          });
          onEvent?.({ type: "tool_result", name: call.name, result });
        }
      }

      if (mcpCalls.length > 0) {
        hop++;
      } else {
        skillOnlyRounds++;
        if (skillOnlyRounds >= maxSkillOnlyRounds) break;
      }
      continue;
    }

    if (response.text) {
      state.messages.push({ role: "assistant", content: response.text });
      return response.text;
    }
    break;
  }

  state.messages.push({ role: "assistant", content: HOP_LIMIT_FALLBACK_MESSAGE });
  return HOP_LIMIT_FALLBACK_MESSAGE;
}

/** Sliding-window trim so a long-running chat session's message history
 * doesn't grow unbounded. Drops oldest turns first; used by
 * apps/agent-runtime's session store, not needed by drafting.ts's one-shot
 * calls. */
export function trimHistory(state: ChatState, maxMessages: number): void {
  if (state.messages.length <= maxMessages) return;
  state.messages.splice(0, state.messages.length - maxMessages);
}
