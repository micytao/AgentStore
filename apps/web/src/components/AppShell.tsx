"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Avatar,
  Brand,
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
} from "@patternfly/react-core";
import { BarsIcon, TasksIcon, ThIcon, UserCogIcon } from "@patternfly/react-icons";
import type { ComponentType } from "react";
import type { Role } from "@agentstore/shared";
import { useRole } from "@/lib/role";
import { UsageChip } from "./UsageChip";

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
              src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Crect width='28' height='28' rx='6' fill='%23c9190b'/%3E%3Cpath d='M14 6.4L16.6 11.9 22.6 12.9 18.3 17.2 19.3 23.2 14 20.3 8.7 23.2 9.7 17.2 5.4 12.9 11.4 11.9 14 6.4Z' fill='white'/%3E%3C/svg%3E"
              alt="AgentStore"
            />
            <span className="agentstore-brand-text">Agent Store</span>
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <div className="agentstore-masthead-actions">
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
