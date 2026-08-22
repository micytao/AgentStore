import { NextResponse } from "next/server";
import { sessionCookieHeader } from "@/server/auth";

/** No passcode in this prototype — clicking the sidebar user chip elevates
 * the session immediately. See apps/web/src/server/auth.ts. */
export async function POST() {
  const res = NextResponse.json({ role: "admin" });
  res.headers.append("Set-Cookie", sessionCookieHeader("admin"));
  return res;
}
