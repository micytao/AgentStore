import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { fetchEeBuildLog } from "@/server/eeBuild";

/**
 * Tail of the "Build from source" build's log — lets the "View build
 * log" section on the AAP Job Templates card show exactly why a build
 * failed (e.g. a missing package in the base image) without the admin
 * needing to open the OpenShift console.
 */
export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ log: await fetchEeBuildLog() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
