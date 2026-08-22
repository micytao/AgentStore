import { draftFor } from "@agentstore/engine-fake";
import type { Listing, ModelMessage, TaskSpec } from "@agentstore/shared";
import { departmentLabel } from "@agentstore/shared";
import { getActiveProvider, getProvider, callProvider } from "./providers";
import { callTool, listEnabledToolsFor } from "./mcp";
import { getSkillsByIds } from "./skills";

const MAX_TOOL_HOPS = 4;

function systemPromptFor(listing: Listing): string {
  const skills = getSkillsByIds(listing.agentConfig?.skillIds);
  const parts = [
    `You are the AI agent behind the "${listing.name}" listing in AgentStore's ${departmentLabel(listing.department)} department.`,
    listing.description,
    "You are running in Autonomous mode: produce a draft result for the requester to review. Nothing you write is sent anywhere automatically — it will be shown to a human who can approve or reject it.",
    "Keep the draft concise and directly usable. If you use a tool, use its result to inform the draft rather than repeating raw tool output verbatim.",
  ];
  for (const skill of skills) {
    parts.push(`Skill: ${skill.name}\n${skill.instructions}`);
  }
  return parts.join("\n\n");
}

/** Resolves which configured provider this agent should draft with: its own
 * per-agent binding if set (and it still exists), otherwise the global
 * active provider — so listings with no explicit binding keep working. */
function providerFor(listing: Listing) {
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
 * optionally calling its bound MCP tools along the way. Falls back to
 * engine-fake's canned per-listing text if no provider is configured or
 * the call fails, so the demo keeps working with zero setup.
 */
export async function generateDraft(spec: TaskSpec, listing: Listing): Promise<string> {
  const provider = providerFor(listing);
  if (!provider) return draftFor(spec);

  try {
    const tools = listEnabledToolsFor(listing.agentConfig);
    const goal = spec.target?.goal ?? "the assigned goal";
    const successCriteria = spec.target?.successCriteria;
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: successCriteria
          ? `Goal: ${goal}\nSuccess criteria: ${successCriteria}`
          : `Goal: ${goal}`,
      },
    ];

    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const response = await callProvider(provider.id, {
        system: systemPromptFor(listing),
        messages,
        tools,
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const call of response.toolCalls) {
          let result: string;
          try {
            result = await callTool(call.serverId, call.name, call.args);
          } catch (err) {
            result = `Tool call failed: ${err instanceof Error ? err.message : String(err)}`;
          }
          messages.push({
            role: "tool",
            toolName: call.name,
            content: `Result of ${call.name}(${JSON.stringify(call.args)}):\n${result}`,
          });
        }
        continue;
      }

      if (response.text) return response.text;
      break;
    }

    return "The model reached the tool-call limit without producing a final draft. Try again or adjust the enabled tools.";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[drafting] Falling back to canned draft for ${spec.listingId}: ${message}`);
    return `${draftFor(spec)}\n\n(Note: real drafting via ${provider.label} failed — ${message}. Showing the simulated draft instead.)`;
  }
}
