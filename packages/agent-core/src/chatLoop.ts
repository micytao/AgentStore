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
 * Each skill load, each MCP tool call, and the final text-producing call are
 * all separate "hops" (one LLM round trip each). 4 was too tight in
 * practice: a listing with several bound skills can burn 3-4 hops just
 * loading skills one at a time (some models don't batch multiple tool
 * calls into a single response even when the API supports it), leaving no
 * hop left to actually answer — surfacing as HOP_LIMIT_FALLBACK_MESSAGE on
 * every single turn for that listing. 8 leaves headroom for a few skill
 * loads plus a couple of real tool calls plus the final answer.
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
export type TurnEvent = { type: "delta"; text: string } | { type: "tool_call"; name: string };

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

  for (let hop = 0; hop < maxHops; hop++) {
    const scopedTools = visibleTools(tools, skills, state.activeSkillIds);
    const toolsForModel = skills.length > 0 ? [...scopedTools, LOAD_SKILL_TOOL] : scopedTools;
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
      for (const call of response.toolCalls) {
        onEvent?.({ type: "tool_call", name: call.name });
        if (call.name === LOAD_SKILL_TOOL_NAME) {
          const skillId = String((call.args as Record<string, unknown> | undefined)?.skill_id ?? "");
          const skill = findSkill(skills, skillId);
          const result = skill
            ? `Skill "${skill.name}" loaded:\n${skill.instructions}`
            : `No skill found with id "${skillId}". Available ids: ${skills.map((s) => s.id).join(", ")}`;
          if (skill) state.activeSkillIds.add(skill.id);
          state.messages.push({ role: "tool", toolName: call.name, content: result });
          continue;
        }
        let result: string;
        try {
          result = await deps.callTool(call.serverId, call.name, call.args);
        } catch (err) {
          result = `Tool call failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        state.messages.push({
          role: "tool",
          toolName: call.name,
          content: `Result of ${call.name}(${JSON.stringify(call.args)}):\n${result}`,
        });
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
