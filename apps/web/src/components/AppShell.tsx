"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  Brand,
  Button,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  MastheadToggle,
  Nav,
  NavExpandable,
  NavList,
  NavItem,
  Page,
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
  Tooltip,
} from "@patternfly/react-core";
import {
  BarsIcon,
  BrainIcon,
  CloudIcon,
  HomeIcon,
  MoonIcon,
  SunIcon,
  TerminalIcon,
  ThLargeIcon,
} from "@patternfly/react-icons";
import { useTheme } from "@/lib/theme";

/** Red hexagon badge with a bold monoline "A" mark — drawn as strokes (not
 * a system-font glyph) so it renders identically everywhere a data-URI
 * <img> shows up, with no font-loading dependency. The hexagon (rather
 * than, say, a literal fedora) keeps the mark original — a fedora reads as
 * Red Hat's registered trademark, which this project has no affiliation
 * with. */
const BRAND_MARK_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Cpolygon points='14,1 25.3,7.5 25.3,20.5 14,27 2.7,20.5 2.7,7.5' fill='%23c9190b'/%3E%3Cpath d='M14 7L8 22M14 7L20 22M10.2 16.5L17.8 16.5' fill='none' stroke='white' stroke-width='3.1' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

/** AgentStore is an admin-only console (end-user auth/roles are OpenShift's
 * job once this is deployed there — see docs/DEFERRED.md). The sidebar is
 * two top-level items (Landing Page, Catalog) plus a "Settings" group for
 * the remaining admin sections. */
const TOP_LEVEL_ITEMS: {
  href: string;
  label: string;
  icon: ComponentType;
}[] = [
  { href: "/", label: "Landing Page", icon: HomeIcon },
  { href: "/catalog", label: "Catalog", icon: ThLargeIcon },
];

const SETTINGS_ITEMS: {
  href: string;
  label: string;
  icon: ComponentType;
}[] = [
  { href: "/admin/platform", label: "Platform", icon: CloudIcon },
  { href: "/admin/llms", label: "LLMs", icon: BrainIcon },
  { href: "/admin/openshell", label: "OpenShell", icon: TerminalIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadToggle>
          <PageToggleButton
            isSidebarOpen={isSidebarOpen}
            onSidebarToggle={() => setIsSidebarOpen((open) => !open)}
            id="agentstore-sidebar-toggle"
            aria-label="Toggle navigation"
          >
            <BarsIcon />
          </PageToggleButton>
        </MastheadToggle>
        <MastheadBrand className="agentstore-masthead-brand">
          <MastheadLogo component={(props) => <Link {...props} href="/" />}>
            <Brand
              className="agentstore-brand-mark"
              src={BRAND_MARK_SRC}
              alt="AgentStore"
            />
            <span className="agentstore-brand-text">Agent Store</span>
          </MastheadLogo>
          <span className="agentstore-brand-subtitle">Agent-As-A-Service</span>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <div className="agentstore-masthead-actions">
          <ThemeToggle />
        </div>
      </MastheadContent>
    </Masthead>
  );

  const settingsActive = pathname.startsWith("/admin");

  const sidebar = (
    <PageSidebar isSidebarOpen={isSidebarOpen}>
      <PageSidebarBody>
        <Nav aria-label="Agent Store">
          <NavList>
            {TOP_LEVEL_ITEMS.map((item) => {
              const Icon = item.icon;
              // "/" is exact-match only (startsWith would match every route).
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <NavItem key={item.href} isActive={active} icon={<Icon />}>
                  <Link href={item.href}>{item.label}</Link>
                </NavItem>
              );
            })}
            <NavExpandable title="Settings" isActive={settingsActive} isExpanded>
              {SETTINGS_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.href);
                return (
                  <NavItem key={item.href} isActive={active} icon={<Icon />}>
                    <Link href={item.href}>{item.label}</Link>
                  </NavItem>
                );
              })}
            </NavExpandable>
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page
      masthead={masthead}
      sidebar={sidebar}
      mainContainerId="agentstore-main"
      onPageResize={() => {
        /* no-op: subscribing is what makes Page track isMobile/width so the
         * sidebar gets its responsive "expanded" state below the xl breakpoint. */
      }}
    >
      {children}
    </Page>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Tooltip content={isDark ? "Switch to light theme" : "Switch to dark theme"}>
      <Button
        variant="plain"
        onClick={toggleTheme}
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        icon={isDark ? <SunIcon /> : <MoonIcon />}
      />
    </Tooltip>
  );
}

