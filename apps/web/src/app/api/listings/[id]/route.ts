import { NextResponse } from "next/server";
import { currentRole } from "@/server/auth";
import { getListing } from "@/server/catalog";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const listing = getListing(id);
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  if (listing.reviewStatus !== "published" && currentRole(request) !== "admin") {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  return NextResponse.json(listing);
}
