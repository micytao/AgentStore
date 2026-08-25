"use client";

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { fetchTerminalEndpoint } from "@/lib/api";

/**
 * Real interactive terminal for an OpenShell-backed task. Connects
 * directly to the Agent Sandbox Service's Route — not through the
 * console — using a short-lived signed token minted just for this
 * connection (see /api/tasks/[id]/terminal-endpoint). SimulatedTerminal
 * is untouched; TaskDetailPage.tsx renders this instead of it only when
 * `task.status.interactive?.kind === "openshell"`.
 */
export function LiveTerminal({ taskId, listingName }: { taskId: string; listingName: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | undefined;
    let socket: WebSocket | undefined;
    let resizeObserver: ResizeObserver | undefined;

    async function boot() {
      const endpoint = await fetchTerminalEndpoint(taskId).catch((err: Error) => {
        throw new Error(`Could not reach the Agent Sandbox Service: ${err.message}`);
      });
      if (endpoint.kind !== "openshell" || !endpoint.url) {
        throw new Error("No live terminal is available for this task yet.");
      }
      if (disposed || !hostRef.current) return;

      const [{ Terminal }, { FitAddon }, { AttachAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-attach"),
      ]);
      if (disposed || !hostRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        theme: {
          background: "#0b0d16",
          foreground: "#e8eaf4",
          cursor: "#7cf0d4",
          cursorAccent: "#0b0d16",
        },
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(hostRef.current);
      fitAddon.fit();

      socket = new WebSocket(endpoint.url);
      socket.addEventListener("open", () => term?.focus());
      socket.addEventListener("close", () => {
        if (!disposed) term?.writeln("\r\n\x1b[2m(session ended)\x1b[0m");
      });
      socket.addEventListener("error", () => {
        if (!disposed) setError("Terminal connection lost.");
      });

      term.loadAddon(new AttachAddon(socket));
      term.onResize(({ cols, rows }) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      resizeObserver = new ResizeObserver(() => fitAddon.fit());
      resizeObserver.observe(hostRef.current);
    }

    void boot().catch((err: Error) => {
      if (!disposed) setError(err.message);
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      socket?.close();
      term?.dispose();
    };
  }, [taskId]);

  return (
    <div className="store-terminal-chrome">
      <div className="store-terminal-bar">
        <span />
        <span />
        <span />
        <em>{listingName}</em>
      </div>
      {error ? (
        <div className="store-terminal is-error">
          <p className="store-banner is-error">{error}</p>
        </div>
      ) : (
        <div ref={hostRef} className="store-terminal" />
      )}
    </div>
  );
}
