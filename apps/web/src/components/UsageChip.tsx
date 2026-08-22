"use client";

import { fetchUsage } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useEffect, useState } from "react";

export function UsageChip({ compact = false }: { compact?: boolean }) {
  const [label, setLabel] = useState("—");

  useEffect(() => {
    const load = () =>
      fetchUsage()
        .then((usage) =>
          setLabel(`${usage.totalTasks} tasks · ${formatUsd(usage.estimatedCost)}`)
        )
        .catch(() => setLabel("offline"));
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="store-usage" title={compact ? label : undefined}>
      <span className="store-usage-dot" />
      {!compact && label}
    </span>
  );
}
