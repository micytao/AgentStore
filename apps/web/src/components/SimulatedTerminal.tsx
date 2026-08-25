"use client";

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

export function SimulatedTerminal({
  listingName,
  live,
}: {
  listingName: string;
  live?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | undefined;
    let buffer = "";

    async function boot() {
      const { Terminal } = await import("@xterm/xterm");
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
      term.open(hostRef.current);
      term.writeln(`\x1b[1m${listingName}\x1b[0m`);
      if (live) {
        term.writeln("Live OpenShell sandbox. Type to work with the agent.");
        term.writeln(
          "(Prototype attach is CLI-backed; this terminal is a session console.)"
        );
      } else {
        term.writeln(
          "Simulated session — configure the Agent Sandbox Service (Admin → LLMs → OpenShell) to attach a real sandbox."
        );
        term.writeln("Workspace: /workspace");
      }
      term.writeln("");
      term.write("$ ");

      term.onData((data) => {
        if (!term) return;
        if (data === "\r") {
          const command = buffer.trim();
          term.writeln("");
          if (command) {
            term.writeln(
              live
                ? `(sandbox) received: ${command}`
                : `I'll help with that. This is a simulated ${listingName} reply.`
            );
          }
          buffer = "";
          term.write("$ ");
          return;
        }
        if (data === "\u007f") {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            term.write("\b \b");
          }
          return;
        }
        buffer += data;
        term.write(data);
      });
      term.focus();
    }

    void boot();
    return () => {
      disposed = true;
      term?.dispose();
    };
  }, [listingName, live]);

  return (
    <div className="store-terminal-chrome">
      <div className="store-terminal-bar">
        <span />
        <span />
        <span />
        <em>{listingName}</em>
      </div>
      <div ref={hostRef} className="store-terminal" />
    </div>
  );
}
