import { draftFor } from "@agentstore/engine-fake";
import type { Listing, TaskSpec } from "@agentstore/shared";
import { departmentLabel } from "@agentstore/shared";
import { createChatState, runTurn } from "@agentstore/agent-core";
import { getActiveProvider, getProvider, callProvider } from "./providers";
import { callTool, listEnabledToolsFor } from "./mcp";
import { getSkillsByIds } from "./skills";

/** Persona intro lines for Autonomous drafting — the skills menu itself is
 * appended by agent-core's buildSystemPrompt(), called from inside
 * runTurn(), so this only carries the parts that are specific to
 * drafting.ts's one-shot "produce a draft" framing. */
function introLinesFor(listing: Listing): string[] {
  return [
    `You are the AI agent behind the "${listing.name}" listing in AgentStore's ${departmentLabel(listing.department)} department.`,
    listing.description,
    "You are running in Autonomous mode: produce a draft result for the requester to review. Nothing you write is sent anywhere automatically — it will be shown to a human who can approve or reject it.",
    "Keep the draft concise and directly usable. If you use a tool, use its result to inform the draft rather than repeating raw tool output verbatim.",
  ];
}

/** Resolves which configured provider this agent should draft with: its own
 * per-agent binding if set (and it still exists), otherwise the global
 * active provider — so listings with no explicit binding keep working.
 * Exported for orchestrator.ts's specFrom(), which resolves the same thing
 * for OpenShell listings to forward to the Agent Sandbox Service. */
export function providerFor(listing: Listing) {
  const boundId = listing.agentConfig?.providerId;
  if (boundId) {
    const bound = getProvider(boundId);
    if (bound) return bound;
  }
  return getActiveProvider();
}

/**
 * Generates a real draft for a `do-this-for-me` task using the agent's
 * bound model provider (or the global active provider as a fallback),
 * optionally calling its bound MCP tools and skills along the way, via
 * @agentstore/agent-core's shared chat loop (a fresh ChatState per call, so
 * this stays one-shot — no history persists between tasks). Falls back to
 * engine-fake's canned per-listing text if no provider is configured or
 * the call fails, so the demo keeps working with zero setup.
 */
export async function generateDraft(spec: TaskSpec, listing: Listing): Promise<string> {
  const provider = providerFor(listing);
  if (!provider) return draftFor(spec);

  try {
    const tools = listEnabledToolsFor(listing.agentConfig);
    const skills = getSkillsByIds(listing.agentConfig?.skillIds);
    const goal = spec.target?.goal ?? "the assigned goal";
    const successCriteria = spec.target?.successCriteria;
    const userMessage = successCriteria
      ? `Goal: ${goal}\nSuccess criteria: ${successCriteria}`
      : `Goal: ${goal}`;

    const state = createChatState();
    return await runTurn(
      {
        callProvider: (opts) => callProvider(provider.id, opts),
        callTool: (serverId, name, args) => callTool(serverId, name, args),
      },
      introLinesFor(listing),
      skills,
      tools,
      state,
      userMessage
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[drafting] Falling back to canned draft for ${spec.listingId}: ${message}`);
    return `${draftFor(spec)}\n\n(Note: real drafting via ${provider.label} failed — ${message}. Showing the simulated draft instead.)`;
  }
}
