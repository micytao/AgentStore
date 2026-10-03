import { NextResponse } from "next/server";
import type { PlatformSettings } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { getPlatformStatus, resetClusterState, savePlatformSettings } from "@/server/platform";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  return NextResponse.json(await getPlatformStatus());
}

export async function PATCH(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const patch = (await request.json()) as Partial<PlatformSettings>;
  savePlatformSettings(patch);
  return NextResponse.json(await getPlatformStatus());
}

/** Clears all cluster-specific state for a fresh-cluster restart. */
export async function DELETE(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  resetClusterState();
  return NextResponse.json(await getPlatformStatus());
}
