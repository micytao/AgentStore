import "@patternfly/react-core/dist/styles/base.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { RoleProvider } from "@/lib/role";
import { ThemeProvider } from "@/lib/theme";
import type { ReactNode } from "react";

export const metadata = {
  title: "Agent Store",
  description: "Internal catalog of governed AI agents",
};

// Applies the stored light/dark preference before hydration so the page
// never flashes the wrong theme on load. Kept inline (not a module) since
// it must run synchronously, before PatternFly's base.css has a chance to
// paint the default (light) theme.
const NO_FLASH_THEME_SCRIPT = `(function () {
  try {
    var stored = window.localStorage.getItem("agentstore-theme");
    if (stored === "dark") {
      document.documentElement.classList.add("pf-v6-theme-dark");
    }
  } catch (e) {}
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <RoleProvider>
            <AppShell>{children}</AppShell>
          </RoleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
