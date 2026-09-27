import { NextResponse } from "next/server";
import { loadListings } from "@/server/catalog";

/** AgentStore is an admin-only console, so this always returns every
 * listing (draft/in-review/published alike) — Admin → Catalog is the only
 * consumer. */
export async function GET(request: Request) {
  const department = new URL(request.url).searchParams.get("department");
  let listings = loadListings();
  if (department && department !== "all") {
    listings = listings.filter((listing) => listing.department === department);
  }
  return NextResponse.json(listings);
}
