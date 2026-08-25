import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { terminalIdleTimeoutMs } from "./config";
import { verifyTerminalToken } from "./auth";

/**
 * The node-pty + WebSocket relay. Confirmed CLI-based by design (per the
 * plan's Kaiden research: `sandbox connect` uses an SSH tunnel + node-pty
 * on their side too, with no typed-SDK alternative) — this spawns the
 * `openshell` CLI's `sandbox connect` under a pty rather than trying to
 * reimplement whatever transport it uses underneath.
 */

interface PtySession {
  proc: pty.IPty;
  sockets: Set<WebSocket>;
  idleTimer?: NodeJS.Timeout;
}

const sessions = new Map<string, PtySession>();

function clearIdleTimer(session: PtySession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = undefined;
}

function armIdleTimer(sessionId: string, session: PtySession): void {
  clearIdleTimer(session);
  if (session.sockets.size > 0) return;
  session.idleTimer = setTimeout(() => killPty(sessionId), terminalIdleTimeoutMs());
}

function attach(sessionId: string): PtySession {
  const existing = sessions.get(sessionId);
  if (existing) return existing;

  const proc = pty.spawn("openshell", ["sandbox", "connect", sessionId], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
  });
  const session: PtySession = { proc, sockets: new Set() };
  sessions.set(sessionId, session);

  proc.onData((data) => {
    for (const socket of session.sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  });
  proc.onExit(() => {
    for (const socket of session.sockets) socket.close(1000, "sandbox session ended");
    sessions.delete(sessionId);
  });

  return session;
}

export function killPty(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  clearIdleTimer(session);
  for (const socket of session.sockets) socket.close(1000, "session terminated");
  try {
    session.proc.kill();
  } catch {
    /* already gone */
  }
  sessions.delete(sessionId);
}

interface ControlFrame {
  type: "resize";
  cols: number;
  rows: number;
}

function isControlFrame(value: unknown): value is ControlFrame {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === "resize"
  );
}

const wss = new WebSocketServer({ noServer: true });

/** Called from server.ts's `upgrade` handler once the URL has been parsed
 * into a sessionId + token. */
export function handleTerminalUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  sessionId: string,
  token: string | null
): void {
  if (!verifyTerminalToken(token, sessionId)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket as never, head, (ws) => {
    const session = attach(sessionId);
    session.sockets.add(ws);
    clearIdleTimer(session);

    ws.on("message", (raw) => {
      const text = raw.toString();
      try {
        const parsed = JSON.parse(text);
        if (isControlFrame(parsed)) {
          session.proc.resize(Math.max(1, parsed.cols), Math.max(1, parsed.rows));
          return;
        }
      } catch {
        /* not a control frame — fall through and treat as raw input below */
      }
      session.proc.write(text);
    });

    ws.on("close", () => {
      session.sockets.delete(ws);
      armIdleTimer(sessionId, session);
    });
  });
}
