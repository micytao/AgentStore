"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AngleDoubleLeftIcon,
  AngleDoubleRightIcon,
  TasksIcon,
  ThIcon,
  UserCogIcon,
} from "@patternfly/react-icons";
import type { Role } from "@agentstore/shared";
import { useRole } from "@/lib/role";
import { UsageChip } from "./UsageChip";

const STORAGE_KEY = "agentstore.sidebarCollapsed";

const NAV_ITEMS = [
  { href: "/", label: "Catalog", icon: ThIcon, match: (p: string) => p === "/" || p.startsWith("/listings") },
  { href: "/tasks", label: "My Tasks", icon: TasksIcon, match: (p: string) => p.startsWith("/tasks") },
  { href: "/admin", label: "Admin", icon: UserCogIcon, match: (p: string) => p.startsWith("/admin") },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  }

  return (
    <div className={`store-shell${collapsed ? " is-collapsed" : ""}`}>
      <aside className="store-sidebar">
        <div className="store-sidebar-top">
          <Link href="/" className="store-brand">
            <span className="store-mark" aria-hidden="true">
              <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="28" height="28" rx="8" fill="url(#storeMarkGradient)" />
                <rect
                  x="0.5"
                  y="0.5"
                  width="27"
                  height="27"
                  rx="7.5"
                  stroke="url(#storeMarkStroke)"
                  strokeOpacity="0.6"
                />
                <path
                  d="M14 6.4L16.6 11.9 22.6 12.9 18.3 17.2 19.3 23.2 14 20.3 8.7 23.2 9.7 17.2 5.4 12.9 11.4 11.9 14 6.4Z"
                  fill="white"
                  fillOpacity="0.95"
                />
                <defs>
                  <linearGradient id="storeMarkGradient" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#9af6de" />
                    <stop offset="1" stopColor="#cbbdff" />
                  </linearGradient>
                  <linearGradient id="storeMarkStroke" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#fff" stopOpacity="0.8" />
                    <stop offset="1" stopColor="#fff" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
            </span>
            <span className="store-brand-text">
              Agent<span>Store</span>
            </span>
          </Link>
          <button
            type="button"
            className="store-sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <AngleDoubleRightIcon aria-hidden="true" />
            ) : (
              <AngleDoubleLeftIcon aria-hidden="true" />
            )}
          </button>
        </div>

        <nav className="store-sidebar-nav" aria-label="Agent Store">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.match(pathname ?? "");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "is-active" : undefined}
                title={collapsed ? item.label : undefined}
              >
                <Icon aria-hidden="true" />
                <span className="store-sidebar-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="store-sidebar-footer">
          <RoleToggle collapsed={collapsed} />
        </div>
      </aside>
      <main className="store-main">
        <div className="store-topbar">
          <UsageChip />
        </div>
        {children}
      </main>
    </div>
  );
}

const ROLE_OPTIONS: { id: Role; label: string; initial: string }[] = [
  { id: "user", label: "Demo", initial: "D" },
  { id: "admin", label: "Admin", initial: "A" },
];

function RoleToggle({ collapsed }: { collapsed: boolean }) {
  const { role, isAdmin, setRole } = useRole();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [open]);

  async function choose(target: Role) {
    setOpen(false);
    if (target !== role) await setRole(target);
  }

  return (
    <div className="store-role-switcher" ref={containerRef}>
      {open && (
        <div className="store-role-menu" role="menu">
          {ROLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              className={`store-role-menu-item${option.id === role ? " is-current" : ""}`}
              onClick={() => void choose(option.id)}
            >
              <span className="store-avatar is-mini">{option.initial}</span>
              {option.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="store-sidebar-user store-role-click"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={collapsed ? "Switch between Demo and Admin" : undefined}
      >
        <span className="store-avatar">{isAdmin ? "A" : "D"}</span>
        <span className="store-sidebar-label store-sidebar-username">
          {isAdmin ? "Admin" : "Demo"}
        </span>
      </button>
    </div>
  );
}
