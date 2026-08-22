import { NextResponse } from "next/server";
import { currentRole } from "@/server/auth";
import { loadListings } from "@/server/catalog";

/** Public catalog: regular users only ever see published agents. Admins see
 * everything (including draft/in-review) so they can preview a listing
 * before publishing it — this is the enforcement that makes "onboard an
 * agent, then it shows up for users" actually true. */
export async function GET(request: Request) {
  const department = new URL(request.url).searchParams.get("department");
  let listings = loadListings();
  if (currentRole(request) !== "admin") {
    listings = listings.filter((listing) => listing.reviewStatus === "published");
  }
  if (department && department !== "all") {
    listings = listings.filter((listing) => listing.department === department);
  }
  return NextResponse.json(listings);
}
