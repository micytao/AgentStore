import { NextResponse } from "next/server";
import { listSecretSummaries } from "@/server/secrets";

export async function GET() {
  return NextResponse.json(listSecretSummaries());
}
