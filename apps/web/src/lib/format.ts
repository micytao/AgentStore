import type { Pricing } from "@agentstore/shared";

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatPrice(pricing: Pricing): string {
  return `${formatUsd(pricing.amount)} / ${pricing.unit === "per-hour" ? "hour" : "task"}`;
}
