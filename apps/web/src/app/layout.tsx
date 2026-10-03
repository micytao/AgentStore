import "@patternfly/react-core/dist/styles/base.css";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme";
import type { ReactNode } from "react";

export const metadata = {
  title: "Agent Store",
  description: "Internal catalog of governed AI agents",
};

const NO_FLASH_THEME_SCRIPT = `(function () {
  try {
    var stored = window.localStorage.getItem("agentstore-theme");
    if (stored === "dark") {
      document.documentElement.classList.add("pf-v6-theme-dark");
    }
  } catch (e) {}
})();`;

/**
 * Root layout — provides <html>, <body>, PatternFly CSS, and ThemeProvider.
 * Does NOT include the AppShell (sidebar/masthead); that wraps only the
 * (shell) route group.  Routes outside that group (e.g. /listing/[id])
 * render standalone.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
