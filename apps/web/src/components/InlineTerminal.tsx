"use client";

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { Alert, Spinner, Bullseye } from "@patternfly/react-core";
import { fetchListingTerminalEndpoint } from "@/lib/api";

/**
 * Inline terminal for an OpenShell listing's persistent sandbox session.
 * Same xterm.js + WebSocket logic as LiveTerminal, but rendered as an
 * inline div that fills its parent container instead of a full-screen
 * portal modal.  Used by the /listing/[id] launch page.
 */
export function InlineTerminal({ listingId }: { listingId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | undefined;
    let socket: WebSocket | undefined;
    let resizeObserver: ResizeObserver | undefined;

    async function boot() {
      const endpoint = await fetchListingTerminalEndpoint(listingId).catch(
        (err: Error) => {
          throw new Error(
            `Could not reach the Agent Sandbox Service: ${err.message}`,
          );
        },
      );
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
      socket.addEventListener("open", () => {
        if (!disposed) setConnecting(false);
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          socket!.send(
            JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }),
          );
        }
        term?.focus();
      });
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
      if (!disposed) {
        setError(err.message);
        setConnecting(false);
      }
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      socket?.close();
      term?.dispose();
    };
  }, [listingId]);

  if (error) {
    return <Alert variant="danger" isInline title={error} />;
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {connecting && (
        <Bullseye style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          <Spinner aria-label="Connecting to terminal" />
        </Bullseye>
      )}
      <div
        ref={hostRef}
        style={{
          width: "100%",
          height: "100%",
          background: "#0b0d16",
          borderRadius: "6px",
          padding: "6px 10px 10px",
        }}
      />
    </div>
  );
}
