import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { callProvider, callProviderStream, HOP_LIMIT_FALLBACK_MESSAGE, runTurn, type TurnEvent } from "@agentstore/agent-core";
import { chatPageHtml } from "./chatPage";
import { loadConfig, port } from "./config";
import { logError, logInfo, logWarn } from "./log";
import { callTool, connectConfiguredServers, listTools } from "./mcpTools";
import { getOrCreateSession, setCookieHeader, touchSession } from "./sessionStore";

/**
 * The generic-chat runtime's entire surface: a static chat page, a health
 * check, and one chat endpoint that runs @agentstore/agent-core's shared
 * tool-hop loop against this pod's persisted session state. Deliberately
 * built on node:http + a tiny manual router, same convention as
 * apps/agent-sandbox-service/src/server.ts, instead of a web framework.
 */

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 200_000) req.destroy(new Error("Request body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({} as T);
      try {
        resolve(JSON.parse(raw) as T);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
  res.end(html);
}

interface ChatRequestBody {
  message?: string;
}

/** First 8 chars of a session id — enough to correlate log lines for one
 * session/turn without printing a full cookie value into the container's
 * (potentially shared/scraped) log stream. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");

  // Skip liveness/readiness probe noise (GET /health) so real traffic and
  // errors aren't buried under a log line every few seconds.
  if (!(req.method === "GET" && url.pathname === "/health")) {
    logInfo(`${req.method} ${url.pathname}`);
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    const config = loadConfig();
    sendHtml(res, 200, chatPageHtml(config.listingName));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    let body: ChatRequestBody;
    try {
      body = await readJsonBody<ChatRequestBody>(req);
    } catch (err) {
      logWarn("Rejected /api/chat request: invalid JSON body", { error: err instanceof Error ? err.message : err });
      sendJson(res, 400, { error: err instanceof Error ? err.message : "Invalid request body" });
      return;
    }
    const message = (body.message ?? "").trim();
    if (!message) {
      sendJson(res, 400, { error: "message is required" });
      return;
    }

    const config = loadConfig();
    const session = getOrCreateSession(req.headers.cookie);
    const tools = listTools();
    const sid = shortId(session.id);
    const startedAt = Date.now();
    logInfo("Turn started", { session: sid, message: truncate(message, 200) });

    // Streamed as newline-delimited JSON (not SSE) so the client can use a
    // plain fetch()+ReadableStream reader — same POST-with-cookies request
    // it already makes, no separate EventSource/GET endpoint needed. Headers
    // (incl. the session Set-Cookie) must go out before the first write.
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      ...(session.isNew ? { "Set-Cookie": setCookieHeader(session.id) } : {}),
    });
    const writeEvent = (event: TurnEvent | { type: "done"; reply: string } | { type: "error"; error: string }) => {
      if (event.type === "tool_call") logInfo("Tool call", { session: sid, tool: event.name });
      res.write(JSON.stringify(event) + "\n");
    };

    try {
      const reply = await runTurn(
        {
          callProvider: (opts) => callProvider(config.provider, opts),
          callTool,
          streamProvider: (opts, onDelta) => callProviderStream(config.provider, opts, onDelta),
        },
        config.introLines,
        config.skills,
        tools,
        session.state,
        message,
        { onEvent: writeEvent }
      );
      touchSession(session.id);
      if (reply === HOP_LIMIT_FALLBACK_MESSAGE) {
        // Looks like a normal completed turn to the model/client, but an
        // operator staring at this listing's logs needs to know it never
        // actually answered — otherwise this is indistinguishable from a
        // genuinely short reply.
        logWarn("Turn hit the tool-call hop limit without a final answer", {
          session: sid,
          durationMs: Date.now() - startedAt,
        });
      } else {
        logInfo("Turn completed", { session: sid, durationMs: Date.now() - startedAt, replyLength: reply.length });
      }
      writeEvent({ type: "done", reply });
    } catch (err) {
      // This is the one that matters most: without it, a failed turn was
      // only ever visible in the NDJSON stream the browser tab received —
      // `podman logs`/`oc logs` showed nothing at all (see the "hanging at
      // Thinking" investigation that motivated this file).
      logError("Turn failed", err, { session: sid, durationMs: Date.now() - startedAt });
      writeEvent({ type: "error", error: err instanceof Error ? err.message : String(err) });
    } finally {
      res.end();
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    // Belt-and-suspenders: handleRequest's own branches already catch their
    // expected failure modes, but if something throws before any of those
    // try/catches (e.g. a bug in routing itself), log it and still answer
    // the socket instead of leaving the client hanging with an unlogged,
    // silently dropped connection.
    logError("Unhandled request error", err, { method: req.method, url: req.url });
    if (!res.headersSent) sendJson(res, 500, { error: "Internal server error" });
    else res.end();
  });
});

server.on("error", (err) => {
  logError("HTTP server error", err);
});

process.on("uncaughtException", (err) => {
  logError("Uncaught exception", err);
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled promise rejection", reason);
});

async function main(): Promise<void> {
  const config = loadConfig();
  await connectConfiguredServers(config.mcpServers);
  server.listen(port(), () => {
    logInfo(`"${config.listingName}" listening`, { port: port(), skills: config.skills.length });
  });
}

void main();
