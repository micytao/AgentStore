"use client";

import type { TaskPhase } from "@agentstore/shared";

const TONE: Record<TaskPhase, string> = {
  Pending: "muted",
  Provisioning: "info",
  Running: "info",
  AwaitingApproval: "warn",
  Completed: "ok",
  Failed: "bad",
  Cancelled: "muted",
};

export function PhaseLabel({ phase }: { phase: TaskPhase }) {
  return <span className={`store-phase is-${TONE[phase]}`}>{phase}</span>;
}
