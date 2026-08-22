import { NextResponse } from "next/server";
import { sessionCookieHeader } from "@/server/auth";

export async function POST() {
  const res = NextResponse.json({ role: "user" });
  res.headers.append("Set-Cookie", sessionCookieHeader("user"));
  return res;
}
