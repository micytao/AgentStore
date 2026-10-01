import type { ModelTool } from "@agentstore/shared";
import { logInfo, logError } from "./log";

/**
 * Built-in tools that run inside the agent-runtime process itself — plain
 * `fetch()` wrappers against public APIs. Registered alongside MCP tools
 * at startup so the model can call them without any MCP server setup.
 *
 * Uses serverId "__builtins__" (same pattern as agent-core's "__agent-core__"
 * for load_skill). The chatLoop dispatches tool calls by serverId; the
 * runtime's dispatchTool() routes "__builtins__" here instead of to MCP.
 */

export const BUILTINS_SERVER_ID = "__builtins__";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_LENGTH = 8_000;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n\n… (truncated)" : text;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function webFetch(args: Record<string, unknown>): Promise<string> {
  const url = String(args.url ?? "");
  if (!url) return "Error: url is required";
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return `HTTP ${res.status} ${res.statusText}`;
    const text = await res.text();
    logInfo(`web_fetch succeeded`, { url, durationMs: Date.now() - startedAt, length: text.length });
    return truncate(text, MAX_RESPONSE_LENGTH);
  } catch (err) {
    logError("web_fetch failed", err, { url, durationMs: Date.now() - startedAt });
    return `Fetch failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function getCveById(args: Record<string, unknown>): Promise<string> {
  const cveId = String(args.cve_id ?? "");
  if (!cveId) return "Error: cve_id is required (e.g. CVE-2024-1234)";
  const url = `https://access.redhat.com/hydra/rest/securitydata/cve/${encodeURIComponent(cveId)}.json`;
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return `Red Hat CVE API returned HTTP ${res.status} for ${cveId}`;
    const text = await res.text();
    logInfo(`get_cve_by_id succeeded`, { cveId, durationMs: Date.now() - startedAt });
    return truncate(text, MAX_RESPONSE_LENGTH);
  } catch (err) {
    logError("get_cve_by_id failed", err, { cveId, durationMs: Date.now() - startedAt });
    return `CVE lookup failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function listAdvisoriesByCve(args: Record<string, unknown>): Promise<string> {
  const cveId = String(args.cve_id ?? "");
  if (!cveId) return "Error: cve_id is required (e.g. CVE-2024-1234)";
  const url = `https://access.redhat.com/hydra/rest/securitydata/cve.json?ids=${encodeURIComponent(cveId)}`;
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return `Red Hat advisory API returned HTTP ${res.status} for ${cveId}`;
    const text = await res.text();
    logInfo(`list_advisories_by_cve succeeded`, { cveId, durationMs: Date.now() - startedAt });
    return truncate(text, MAX_RESPONSE_LENGTH);
  } catch (err) {
    logError("list_advisories_by_cve failed", err, { cveId, durationMs: Date.now() - startedAt });
    return `Advisory lookup failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function getErrataById(args: Record<string, unknown>): Promise<string> {
  const advisoryId = String(args.advisory_id ?? "");
  if (!advisoryId) return "Error: advisory_id is required (e.g. RHSA-2024:0684)";
  const url = `https://access.redhat.com/errata/${encodeURIComponent(advisoryId)}`;
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return `Red Hat errata page returned HTTP ${res.status} for ${advisoryId}`;
    const html = await res.text();

    const extract = (label: string, regex: RegExp): string => {
      const m = html.match(regex);
      return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
    };
    const synopsis = extract("Synopsis", /<h2>Synopsis<\/h2>\s*<p>([\s\S]*?)<\/p>/);
    const typeSeverity = extract("Type/Severity", /<h2>Type\/Severity<\/h2>\s*<p>([\s\S]*?)<\/p>/);
    const description = extract("Description", /<h2>Description<\/h2>\s*<p>([\s\S]*?)<\/p>/);

    const result = JSON.stringify({
      advisory_id: advisoryId,
      synopsis: synopsis || "(not found)",
      type_severity: typeSeverity || "(not found)",
      description: truncate(description || "(not found)", 2000),
      url,
    });
    logInfo(`get_errata_by_id succeeded`, { advisoryId, durationMs: Date.now() - startedAt });
    return truncate(result, MAX_RESPONSE_LENGTH);
  } catch (err) {
    logError("get_errata_by_id failed", err, { advisoryId, durationMs: Date.now() - startedAt });
    return `Errata lookup failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function listAdvisoryPackages(args: Record<string, unknown>): Promise<string> {
  const advisoryId = String(args.advisory_id ?? "");
  if (!advisoryId) return "Error: advisory_id is required (e.g. RHSA-2024:0684)";
  const url = `https://access.redhat.com/hydra/rest/securitydata/cve.json?advisory=${encodeURIComponent(advisoryId)}`;
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return `Red Hat advisory packages API returned HTTP ${res.status} for ${advisoryId}`;
    const text = await res.text();
    logInfo(`list_advisory_packages succeeded`, { advisoryId, durationMs: Date.now() - startedAt });
    return truncate(text, MAX_RESPONSE_LENGTH);
  } catch (err) {
    logError("list_advisory_packages failed", err, { advisoryId, durationMs: Date.now() - startedAt });
    return `Advisory packages lookup failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  web_fetch: webFetch,
  get_cve_by_id: getCveById,
  list_advisories_by_cve: listAdvisoriesByCve,
  get_errata_by_id: getErrataById,
  list_advisory_packages: listAdvisoryPackages,
};

/** Tool descriptors exposed to the model — merged with MCP tools at startup. */
export const builtinToolDescriptors: ModelTool[] = [
  {
    serverId: BUILTINS_SERVER_ID,
    name: "web_fetch",
    description: "Fetch the contents of a URL and return the response body as text. Use for looking up documentation, API responses, or any public web page.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
  },
  {
    serverId: BUILTINS_SERVER_ID,
    name: "get_cve_by_id",
    description: "Look up a CVE by its ID using the Red Hat Security Data API. Returns severity, description, CVSS score, affected packages, and linked advisories.",
    inputSchema: {
      type: "object",
      properties: {
        cve_id: { type: "string", description: "The CVE identifier, e.g. CVE-2024-1234" },
      },
      required: ["cve_id"],
    },
  },
  {
    serverId: BUILTINS_SERVER_ID,
    name: "list_advisories_by_cve",
    description: "List Red Hat Security Advisories (RHSAs) linked to a given CVE. Returns advisory IDs, severity, and affected products.",
    inputSchema: {
      type: "object",
      properties: {
        cve_id: { type: "string", description: "The CVE identifier, e.g. CVE-2024-1234" },
      },
      required: ["cve_id"],
    },
  },
  {
    serverId: BUILTINS_SERVER_ID,
    name: "get_errata_by_id",
    description: "Look up a Red Hat advisory (RHSA/RHBA/RHEA) by its ID. Returns the synopsis, type/severity, and description from the errata page.",
    inputSchema: {
      type: "object",
      properties: {
        advisory_id: { type: "string", description: "The advisory identifier, e.g. RHSA-2024:0684" },
      },
      required: ["advisory_id"],
    },
  },
  {
    serverId: BUILTINS_SERVER_ID,
    name: "list_advisory_packages",
    description: "List CVEs and affected packages for a given Red Hat advisory. Returns CVE IDs, severity, and the specific package versions fixed by this advisory.",
    inputSchema: {
      type: "object",
      properties: {
        advisory_id: { type: "string", description: "The advisory identifier, e.g. RHSA-2024:0684" },
      },
      required: ["advisory_id"],
    },
  },
];

/** Dispatch a built-in tool call by name. Throws if the tool name is unknown. */
export async function callBuiltinTool(name: string, args: Record<string, unknown>): Promise<string> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) throw new Error(`Unknown built-in tool: ${name}`);
  return handler(args);
}
