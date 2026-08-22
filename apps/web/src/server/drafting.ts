import { draftFor } from "@agentstore/engine-fake";
import type { Listing, ModelMessage, TaskSpec } from "@agentstore/shared";
import { departmentLabel } from "@agentstore/shared";
import { getActiveProvider, callProvider } from "./providers";
import { callTool, listEnabledTools } from "./mcp";

const MAX_TOOL_HOPS = 4;

function systemPromptFor(listing: Listing): string {
  return [
    `You are the AI agent behind the "${listing.name}" listing in AgentStore's ${departmentLabel(listing.department)} department.`,
    listing.description,
    "You are running in Autonomous mode: produce a draft result for the requester to review. Nothing you write is sent anywhere automatically — it will be shown to a human who can approve or reject it.",
    "Keep the draft concise and directly usable. If you use a tool, use its result to inform the draft rather than repeating raw tool output verbatim.",
  ].join("\n\n");
}

/**
 * Generates a real draft for a `do-this-for-me` task using the active model
 * provider, optionally calling enabled MCP tools along the way. Falls back
 * to engine-fake's canned per-listing text if no provider is configured or
 * the call fails, so the demo keeps working with zero setup.
 */
export async function generateDraft(spec: TaskSpec, listing: Listing): Promise<string> {
  const provider = getActiveProvider();
  if (!provider) return draftFor(spec);

  try {
    const tools = listEnabledTools();
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
