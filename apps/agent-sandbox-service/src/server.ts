import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { OpenShellMcpServerConfig, OpenShellModelConfig } from "@agentstore/shared";
import { checkBearerToken, mintTerminalToken } from "./auth";
import { port, terminalPublicProtocol, terminalTokenTtlMs } from "./config";
import { createSession, deleteSession, getSession, refreshSession } from "./sessions";
import { handleTerminalUpgrade, killPty } from "./terminal";

/**
 * The Agent Sandbox Service's entire REST + WebSocket surface, per the
 * plan's "consume a service, don't run one" architecture: the console
 * (packages/engine-openshell) is a thin client of exactly these five
 * endpoints, plus /health for the Admin → Platform connection check.
 *
 * Deliberately built on node:http + a tiny manual router instead of a web
 * framework — see the plan's "dependency footprint" note.
 */

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy(new Error("Request body too large"));
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

interface CreateSessionBody {
  taskId: string;
  agent: string;
  model?: OpenShellModelConfig;
  mcpServers?: OpenShellMcpServerConfig[];
  gitUrl?: string;
  gitToken?: string;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");
  const segments = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && segments.length === 1 && segments[0] === "health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (segments[0] !== "sessions") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (!checkBearerToken(req.headers.authorization)) {
    sendJson(res, 401, { error: "Missing or invalid Authorization bearer token" });
    return;
  }

  try {
    // POST /sessions
    if (req.method === "POST" && segments.length === 1) {
      const body = await readJsonBody<CreateSessionBody>(req);
      if (!body.taskId || !body.agent) {
        sendJson(res, 400, { error: "taskId and agent are required" });
        return;
      }
      const session = await createSession(body);
      sendJson(res, 201, session);
      return;
    }

    // GET /sessions/:id
    if (req.method === "GET" && segments.length === 2) {
      const session = await refreshSession(segments[1]);
      if (!session) {
        sendJson(res, 404, { error: "Unknown session" });
        return;
      }
      sendJson(res, 200, session);
      return;
    }

    // DELETE /sessions/:id
    if (req.method === "DELETE" && segments.length === 2) {
      const id = segments[1];
      killPty(id);
      await deleteSession(id);
      sendJson(res, 200, { ok: true });
      return;
    }

    // POST /sessions/:id/terminal-token
    if (req.method === "POST" && segments.length === 3 && segments[2] === "terminal-token") {
      const id = segments[1];
      const session = getSession(id);
      if (!session) {
        sendJson(res, 404, { error: "Unknown session" });
        return;
      }
      const token = mintTerminalToken(id, terminalTokenTtlMs());
      // The Host header reflects whatever externally-reachable Route the
      // browser/console actually used to reach us — building the URL from
      // that (rather than a guessed env var) keeps this correct regardless
      // of how the Route is configured.
      const host = req.headers.host ?? "localhost";
      const wsUrl = new URL(`${terminalPublicProtocol()}://${host}/sessions/${id}/terminal`);
      wsUrl.searchParams.set("token", token);
      sendJson(res, 200, { url: wsUrl.toString() });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://internal");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 3 && segments[0] === "sessions" && segments[2] === "terminal") {
    handleTerminalUpgrade(req, socket, head, segments[1], url.searchParams.get("token"));
    return;
  }
  socket.destroy();
});

server.listen(port(), () => {
  console.log(`[agent-sandbox-service] listening on :${port()}`);
});
