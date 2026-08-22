import { NextResponse } from "next/server";
import { usage } from "@/server/orchestrator";

export async function GET() {
  return NextResponse.json(await usage());
}
