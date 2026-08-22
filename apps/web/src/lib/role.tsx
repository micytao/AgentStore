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

interface RoleContextValue {
  role: Role;
  isAdmin: boolean;
  /** True until the initial GET /api/session check resolves. */
  loading: boolean;
  /** Switches directly to the given role. No passcode in this prototype —
   * see apps/web/src/server/auth.ts. */
  setRole: (role: Role) => Promise<void>;
}

const RoleContext = createContext<RoleContextValue | null>(null);

/**
 * Role reflects a server-side session (see apps/web/src/server/auth.ts)
 * instead of a client-only localStorage flag, so /api/admin/** routes have
 * something authoritative to check — this provider just mirrors it so the
 * UI can react without a full page reload.
 */
export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>("user");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/session");
      const body = (await res.json()) as { role?: Role };
      setRoleState(body.role === "admin" ? "admin" : "user");
    } catch {
      setRoleState("user");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setRole = useCallback(
    async (target: Role) => {
      if (target === role) return;
      const endpoint = target === "admin" ? "/api/session/elevate" : "/api/session/downgrade";
      await fetch(endpoint, { method: "POST" });
      await refresh();
    },
    [role, refresh]
  );

  return (
    <RoleContext.Provider value={{ role, isAdmin: role === "admin", loading, setRole }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within a RoleProvider");
  return ctx;
}
