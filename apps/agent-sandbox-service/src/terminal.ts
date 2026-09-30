import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ExecInteractiveSessionControl, ExecStreamEvent } from "@nvidia/openshell-sdk";
import { WebSocket, WebSocketServer } from "ws";
import { terminalIdleTimeoutMs } from "./config.js";
import { verifyTerminalToken } from "./auth.js";
import { getClient } from "./openshellClient.js";

/**
 * Terminal relay: OpenShell SDK execInteractive + WebSocket.
 *
 * "Open terminal" calls `execInteractive(name, ["/bin/sh"])` to spawn
 * a fresh interactive shell alongside the sandbox's canonical main
 * process. Each terminal tab gets its own shell session — the agent
 * process runs independently as the sandbox's canonical command.
 */

interface SdkSession {
  session: ExecInteractiveSessionControl;
  sockets: Set<WebSocket>;
  idleTimer?: NodeJS.Timeout;
  /** Set to true once output consumption loop has been started. */
  outputStarted: boolean;
}

const sessions = new Map<string, SdkSession>();

function clearIdleTimer(entry: SdkSession): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = undefined;
}

function armIdleTimer(sessionId: string, entry: SdkSession): void {
  clearIdleTimer(entry);
  if (entry.sockets.size > 0) return;
  entry.idleTimer = setTimeout(() => killSession(sessionId), terminalIdleTimeoutMs());
}

async function startOutputConsumer(sessionId: string, entry: SdkSession): Promise<void> {
  if (entry.outputStarted) return;
  entry.outputStarted = true;
  try {
    for await (const event of entry.session.output) {
      if ("type" in event) {
        // Exit event — session ended.
        break;
      }
      const data = event.data;
      for (const socket of entry.sockets) {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      }
    }
  } catch {
    // Stream ended or was cancelled — clean up below.
  } finally {
    for (const socket of entry.sockets) socket.close(1000, "sandbox session ended");
    sessions.delete(sessionId);
  }
}

async function attach(sessionId: string): Promise<SdkSession> {
  const existing = sessions.get(sessionId);
  if (existing) return existing;

  const client = await getClient();
  const session = await client.sandbox.execInteractive(
    sessionId,
    ["/bin/sh"],
    { tty: true, cols: 80, rows: 24 },
  );

  const entry: SdkSession = { session, sockets: new Set(), outputStarted: false };
  sessions.set(sessionId, entry);

  // Start consuming output in the background.
  void startOutputConsumer(sessionId, entry);

  return entry;
}

export function killPty(sessionId: string): void {
  killSession(sessionId);
}

function killSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  clearIdleTimer(entry);
  for (const socket of entry.sockets) socket.close(1000, "session terminated");
  try {
    entry.session.cancel();
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
    // The SDK's execInteractive is async — handle it within the callback.
    void (async () => {
      try {
        const entry = await attach(sessionId);
        entry.sockets.add(ws);
        clearIdleTimer(entry);

        ws.on("message", (raw) => {
          const text = raw.toString();
          try {
            const parsed = JSON.parse(text);
            if (isControlFrame(parsed)) {
              entry.session.resize(Math.max(1, parsed.cols), Math.max(1, parsed.rows));
              return;
            }
          } catch {
            /* not a control frame — fall through and treat as raw input below */
          }
          entry.session.write(Buffer.from(text));
        });

        ws.on("close", () => {
          entry.sockets.delete(ws);
          armIdleTimer(sessionId, entry);
        });
      } catch (err) {
        ws.close(1011, err instanceof Error ? err.message.slice(0, 120) : "Failed to attach");
      }
    })();
  });
}
