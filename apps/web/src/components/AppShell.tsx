"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Avatar,
  Brand,
  Button,
  Dropdown,
  DropdownItem,
  DropdownList,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  MastheadToggle,
  MenuToggle,
  Nav,
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
  MoonIcon,
  SunIcon,
  TasksIcon,
  ThIcon,
  UserCogIcon,
} from "@patternfly/react-icons";
import type { ComponentType } from "react";
import type { Role } from "@agentstore/shared";
import { useRole } from "@/lib/role";
import { useTheme } from "@/lib/theme";
import { UsageChip } from "./UsageChip";

/** Red rounded-square badge with a bold monoline "A" mark — drawn as
 * strokes (not a system-font glyph) so it renders identically everywhere
 * a data-URI <img> shows up, with no font-loading dependency. */
const BRAND_MARK_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Crect width='28' height='28' rx='7' fill='%23c9190b'/%3E%3Cpath d='M14 7L8 22M14 7L20 22M10.2 16.5L17.8 16.5' fill='none' stroke='white' stroke-width='3.1' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

const NAV_ITEMS: {
  href: string;
  label: string;
  icon: ComponentType;
  match: (p: string) => boolean;
}[] = [
  { href: "/", label: "Catalog", icon: ThIcon, match: (p) => p === "/" || p.startsWith("/listings") },
  { href: "/tasks", label: "My Tasks", icon: TasksIcon, match: (p) => p.startsWith("/tasks") },
  { href: "/admin", label: "Admin", icon: UserCogIcon, match: (p) => p.startsWith("/admin") },
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
        <MastheadBrand>
          <MastheadLogo component={(props) => <Link {...props} href="/" />}>
            <Brand
              className="agentstore-brand-mark"
              src={BRAND_MARK_SRC}
              alt="AgentStore"
            />
            <span className="agentstore-brand-text">Agent Store</span>
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <div className="agentstore-masthead-actions">
          <ThemeToggle />
          <UsageChip />
          <RoleSwitcher />
        </div>
      </MastheadContent>
    </Masthead>
  );

  const sidebar = (
    <PageSidebar isSidebarOpen={isSidebarOpen}>
      <PageSidebarBody>
        <Nav aria-label="Agent Store">
          <NavList>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.match(pathname);
              return (
                <NavItem key={item.href} isActive={active} icon={<Icon />}>
                  <Link href={item.href}>{item.label}</Link>
                </NavItem>
              );
            })}
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

const ROLE_OPTIONS: { id: Role; label: string; initials: string }[] = [
  { id: "user", label: "Demo", initials: "D" },
  { id: "admin", label: "Admin", initials: "A" },
];

function RoleSwitcher() {
  const { role, isAdmin, setRole } = useRole();
  const [isOpen, setIsOpen] = useState(false);
  const current = ROLE_OPTIONS.find((option) => option.id === role) ?? ROLE_OPTIONS[0];

  async function choose(target: Role) {
    setIsOpen(false);
    if (target !== role) await setRole(target);
  }

  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      toggle={(toggleRef) => (
        <MenuToggle
          ref={toggleRef}
          variant="plain"
          onClick={() => setIsOpen((open) => !open)}
          isExpanded={isOpen}
          aria-label="Switch between Demo and Admin"
        >
          <Avatar
            initials={current.initials}
            alt={current.label}
            size="sm"
            color={isAdmin ? "red" : "blue"}
          />
        </MenuToggle>
      )}
      popperProps={{ position: "right" }}
    >
      <DropdownList>
        {ROLE_OPTIONS.map((option) => (
          <DropdownItem
            key={option.id}
            value={option.id}
            isSelected={option.id === role}
            onClick={() => void choose(option.id)}
          >
            {option.label}
          </DropdownItem>
        ))}
      </DropdownList>
    </Dropdown>
  );
}
