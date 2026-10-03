import { AppShell } from "@/components/AppShell";
import type { ReactNode } from "react";

/**
 * Layout for all admin/catalog pages — wraps children in the AppShell
 * (masthead + sidebar navigation).  Route-group "(shell)" means the URL
 * paths are unaffected (/ , /catalog, /admin/* all stay the same).
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
