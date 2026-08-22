import type { AgentMode } from "@agentstore/shared";

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function modeLabel(mode: AgentMode): string {
  return mode === "work-with-me" ? "Collaborative" : "Autonomous";
}
