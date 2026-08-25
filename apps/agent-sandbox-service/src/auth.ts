import crypto from "node:crypto";
import { serviceToken, terminalTokenSecret } from "./config";

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Console -> service auth for every /sessions* request. Fails closed: if
 * OPENSHELL_SERVICE_TOKEN isn't set, every request is rejected rather than
 * silently allowed. */
export function checkBearerToken(authorizationHeader: string | undefined): boolean {
  const expected = serviceToken();
  if (!expected) return false;
  if (!authorizationHeader) return false;
  const [scheme, value] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !value) return false;
  return timingSafeEqual(value, expected);
}

interface TerminalTokenPayload {
  sessionId: string;
  exp: number;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", terminalTokenSecret()).update(body).digest("base64url");
}

/** The only access-control boundary for the terminal WebSocket, which is
 * reached directly by the browser, bypassing the console's own auth
 * entirely — see the plan's "Stage B3" notes. */
export function mintTerminalToken(sessionId: string, ttlMs: number): string {
  const payload: TerminalTokenPayload = { sessionId, exp: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyTerminalToken(token: string | null | undefined, sessionId: string): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  if (sign(body) !== sig) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TerminalTokenPayload;
    return payload.sessionId === sessionId && payload.exp > Date.now();
  } catch {
    return false;
  }
}
