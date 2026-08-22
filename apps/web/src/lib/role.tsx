"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Role } from "@agentstore/shared";

const STORAGE_KEY = "agentstore.role";

interface RoleContextValue {
  role: Role;
  isAdmin: boolean;
  setRole: (role: Role) => void;
  toggleRole: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>("user");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "admin" || saved === "user") setRoleState(saved);
  }, []);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggleRole = useCallback(() => {
    setRole(role === "admin" ? "user" : "admin");
  }, [role, setRole]);

  return (
    <RoleContext.Provider
      value={{ role, isAdmin: role === "admin", setRole, toggleRole }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within a RoleProvider");
  return ctx;
}
