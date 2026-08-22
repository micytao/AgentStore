import { NextResponse } from "next/server";
import type { ListingUpdate } from "@agentstore/shared";
import { updateListing } from "@/server/catalog";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const patch = (await request.json()) as ListingUpdate;
  const listing = updateListing(id, patch);
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  return NextResponse.json(listing);
}
