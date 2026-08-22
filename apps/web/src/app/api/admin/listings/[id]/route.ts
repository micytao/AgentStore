import { NextResponse } from "next/server";
import type { ListingUpdate } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { deleteListing, updateListing } from "@/server/catalog";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  const patch = (await request.json()) as ListingUpdate;
  const listing = updateListing(id, patch);
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  return NextResponse.json(listing);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    deleteListing(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
