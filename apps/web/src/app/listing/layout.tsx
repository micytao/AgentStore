import type { ReactNode } from "react";

/**
 * Standalone layout for /listing/* pages — renders children directly
 * without the AppShell sidebar/nav.  End users arriving from RHDH
 * "Launch Agent" links see only the agent info and terminal.
 */
export default function ListingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
