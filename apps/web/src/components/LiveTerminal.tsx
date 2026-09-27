"use client";

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { Alert, Card, CardBody, CardTitle } from "@patternfly/react-core";
import { fetchListingTerminalEndpoint } from "@/lib/api";

/**
 * Real interactive terminal for an OpenShell listing's persistent sandbox
 * session. Connects directly to the Agent Sandbox Service's Route — not
 * through the console — using a short-lived signed token minted just for
 * this connection (see /api/admin/listings/[id]/terminal-endpoint).
 * Rendered inline in the Admin → Catalog Agent config panel once a
 * listing's `openshellSession.status === "running"`.
 */
export function LiveTerminal({ listingId, listingName }: { listingId: string; listingName: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [listingId]);

  return (
    <Card isCompact>
      <CardTitle>{listingName}</CardTitle>
      <CardBody>
        {error ? (
          <Alert variant="danger" isInline title={error} />
        ) : (
          <div ref={hostRef} className="store-terminal" />
        )}
      </CardBody>
    </Card>
  );
}
