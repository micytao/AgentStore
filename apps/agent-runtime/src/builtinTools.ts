import TurndownService from "turndown";
import type { ModelTool } from "@agentstore/shared";
import { logInfo, logError } from "./log";

/**
 * Built-in tools that run inside the agent-runtime process itself.
 * Currently just `web_fetch` — a smart HTTP fetcher that auto-detects
 * content type and converts HTML to markdown via turndown.
 *
 * Uses serverId "__builtins__". The runtime's dispatcher routes
 * "__builtins__" here instead of to MCP.
 */

export const BUILTINS_SERVER_ID = "__builtins__";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_LENGTH = 8_000;

// ---------------------------------------------------------------------------
// Turndown instance (reused across calls)
// ---------------------------------------------------------------------------

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

/** Strip non-content tags before turndown processes the HTML. */
function preCleanHtml(html: string): string {
  return html.replace(
    /<(script|style|nav|header|footer|noscript|svg|link|meta)[^>]*>[\s\S]*?<\/\1>/gi,
    ""
  ).replace(
    /<(script|style|link|meta|noscript)[^>]*\/?\s*>/gi,
    ""
  );
}

/** Convert HTML to clean markdown. */
function htmlToMarkdown(html: string): string {
  const cleaned = preCleanHtml(html);
  return turndown.turndown(cleaned);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n\n… (truncated)" : text;
}

// ---------------------------------------------------------------------------
// web_fetch implementation
// ---------------------------------------------------------------------------

async function webFetch(args: Record<string, unknown>): Promise<string> {
  const url = String(args.url ?? "");
  if (!url) return "Error: url is required";

  const method = String(args.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};
  if (args.headers && typeof args.headers === "object") {
    for (const [k, v] of Object.entries(args.headers as Record<string, unknown>)) {
      headers[k] = String(v);
    }
  }
  const body = args.body != null ? String(args.body) : undefined;

  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: method !== "GET" && method !== "HEAD" ? body : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return `HTTP ${res.status} ${res.statusText}`;

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const durationMs = Date.now() - startedAt;

    let result: string;
    if (contentType.includes("text/html")) {
      result = htmlToMarkdown(raw);
      logInfo("web_fetch succeeded (html→md)", { url, durationMs, rawLen: raw.length, mdLen: result.length });
    } else {
      result = raw;
      logInfo("web_fetch succeeded", { url, durationMs, length: raw.length });
    }

    return truncate(result, MAX_RESPONSE_LENGTH);
  } catch (err) {
    logError("web_fetch failed", err, { url, durationMs: Date.now() - startedAt });
    return `Fetch failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  web_fetch: webFetch,
};

/** Tool descriptors exposed to the model — merged with MCP tools at startup. */
export const builtinToolDescriptors: ModelTool[] = [
  {
    serverId: BUILTINS_SERVER_ID,
    name: "web_fetch",
    description:
      "Fetch a URL and return its content. JSON responses are returned as-is. " +
      "HTML pages are automatically converted to clean markdown (headers, links, lists preserved). " +
      "Use for API calls, documentation lookups, or any public web resource.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        method: { type: "string", description: "HTTP method (default: GET)", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        headers: { type: "object", description: "Optional HTTP headers as key-value pairs" },
        body: { type: "string", description: "Optional request body (for POST/PUT/PATCH)" },
      },
      required: ["url"],
    },
  },
];

/** Dispatch a built-in tool call by name. Throws if the tool name is unknown. */
export async function callBuiltinTool(name: string, args: Record<string, unknown>): Promise<string> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) throw new Error(`Unknown built-in tool: ${name}`);
  return handler(args);
}
