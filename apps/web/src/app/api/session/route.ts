import { NextResponse } from "next/server";
import { currentRole } from "@/server/auth";

export async function GET(request: Request) {
  return NextResponse.json({ role: currentRole(request) });
}
