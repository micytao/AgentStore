import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { Role } from "@agentstore/shared";

/**
 * Lightweight Admin/Demo session for this prototype: no login, no
 * passcode — clicking the sidebar user chip elevates or downgrades
 * instantly (see POST /api/session/elevate|downgrade). The signed,
 * httpOnly cookie just keeps the role authoritative on the server (so
 * every /api/admin/** route can call requireAdmin() instead of trusting a
 * client-side flag) without pretending this is real access control. Real
 * per-user auth (SSO/OIDC) is a documented follow-up — see
 * docs/DEFERRED.md.
 */

const COOKIE_NAME = "agentstore_session";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12h

function sessionSecret(): Buffer {
  const secret =
    process.env.SESSION_SECRET ||
    process.env.SECRETS_ENCRYPTION_KEY ||
    "agentstore-dev-session-secret-change-me";
  return crypto.createHash("sha256").update(secret).digest();
}

function sign(value: string): string {
  const mac = crypto.createHmac("sha256", sessionSecret()).update(value).digest("hex");
  return `${value}.${mac}`;
}

function verify(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const value = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = crypto.createHmac("sha256", sessionSecret()).update(value).digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return undefined;
}

/** Reads the role from the signed session cookie. Never throws. */
export function currentRole(request: Request): Role {
  const raw = readCookie(request, COOKIE_NAME);
  if (!raw) return "user";
  const value = verify(raw);
  return value === "admin" ? "admin" : "user";
}

/** Call at the top of every /api/admin/** route. Returns a 401 response to
 * short-circuit the handler if the caller isn't in an admin session, or
 * null if the request may proceed. */
export function requireAdmin(request: Request): NextResponse | null {
  if (currentRole(request) !== "admin") {
    return NextResponse.json(
      { error: "Admin session required. Switch to Admin from the sidebar first." },
      { status: 401 }
    );
  }
  return null;
}

export function sessionCookieHeader(role: Role): string {
  if (role === "user") {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  const token = sign(role);
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}
