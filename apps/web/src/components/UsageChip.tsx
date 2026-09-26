"use client";

import { Label } from "@patternfly/react-core";
import { fetchUsage } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useEffect, useState } from "react";

export function UsageChip() {
  const [label, setLabel] = useState("—");
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const load = () =>
      fetchUsage()
        .then((usage) => {
          setIsOffline(false);
          setLabel(`${usage.totalTasks} tasks · ${formatUsd(usage.estimatedCost)}`);
        })
        .catch(() => {
          setIsOffline(true);
          setLabel("offline");
        });
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Label isCompact color={isOffline ? "grey" : "green"}>
      {label}
    </Label>
  );
}
