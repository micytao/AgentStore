import "@patternfly/react-core/dist/styles/base.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { RoleProvider } from "@/lib/role";
import type { ReactNode } from "react";

export const metadata = {
  title: "Agent Store",
  description: "Internal catalog of governed AI agents",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RoleProvider>
          <AppShell>{children}</AppShell>
        </RoleProvider>
      </body>
    </html>
  );
}
