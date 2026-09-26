"use client";

import type { TaskPhase } from "@agentstore/shared";
import { Label } from "@patternfly/react-core";

const COLOR: Record<TaskPhase, "blue" | "green" | "orange" | "red" | "grey"> = {
  Pending: "grey",
  Provisioning: "blue",
  Running: "blue",
  AwaitingApproval: "orange",
  Completed: "green",
  Failed: "red",
  Cancelled: "grey",
};

export function PhaseLabel({ phase }: { phase: TaskPhase }) {
  return (
    <Label color={COLOR[phase]} isCompact>
      {phase}
    </Label>
  );
}
