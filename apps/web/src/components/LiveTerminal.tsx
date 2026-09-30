"use client";

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { Alert } from "@patternfly/react-core";
import { fetchListingTerminalEndpoint } from "@/lib/api";

/**
 * Full-screen modal terminal for an OpenShell listing's persistent sandbox
 * session. Connects directly to the Agent Sandbox Service's Route — not
 * through the console — using a short-lived signed token minted just for
 * this connection (see /api/admin/listings/[id]/terminal-endpoint).
 *
 * Rendered as a dark overlay with a centered terminal pane; the user
 * closes it via the × button or the Escape key.
 */
export function LiveTerminal({
  listingId,
  listingName,
  onClose,
}: {
  listingId: string;
  listingName: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | undefined;
    let socket: WebSocket | undefined;
    let resizeObserver: ResizeObserver | undefined;

    async function boot() {
      const endpoint = await fetchListingTerminalEndpoint(listingId).catch((err: Error) => {
        throw new Error(`Could not reach the Agent Sandbox Service: ${err.message}`);
      });
      if (!endpoint.url) {
        throw new Error("No live terminal is available for this listing yet.");
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
        fontSize: 14,
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
  }, [listingId]);

  return (
    <div className="terminal-modal-backdrop" onClick={onClose}>
      <div className="terminal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="terminal-modal-header">
          <span className="terminal-modal-title">{listingName}</span>
          <button className="terminal-modal-close" onClick={onClose} aria-label="Close terminal">
            ✕
          </button>
        </div>
        <div className="terminal-modal-body">
          {error ? (
            <Alert variant="danger" isInline title={error} />
          ) : (
            <div ref={hostRef} className="terminal-modal-xterm" />
          )}
        </div>
      </div>
    </div>
  );
}
