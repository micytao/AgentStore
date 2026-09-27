"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "agentstore-theme";
/** PatternFly v6 flips every component's color tokens (Masthead, Nav, Page,
 * Card, etc.) to their dark variants when this class is present on the
 * document root — see @patternfly/react-core/dist/styles/base.css's
 * `:root:where(.pf-v6-theme-dark)` block. */
const DARK_CLASS = "pf-v6-theme-dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeClass(theme: Theme) {
  document.documentElement.classList.toggle(DARK_CLASS, theme === "dark");
}

/**
 * Tracks light/dark mode as a client-only preference (localStorage), no
 * server session involved. A tiny inline script in layout.tsx's <head>
 * applies the stored class before hydration so there's no flash of the
 * wrong theme; this provider just mirrors that into React state so the
 * toggle button can react.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const isDark = document.documentElement.classList.contains(DARK_CLASS);
    setTheme(isDark ? "dark" : "light");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      applyThemeClass(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore (e.g. Safari private mode) */
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
