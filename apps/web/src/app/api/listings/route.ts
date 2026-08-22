import { NextResponse } from "next/server";
import { loadListings } from "@/server/catalog";

export async function GET(request: Request) {
  const department = new URL(request.url).searchParams.get("department");
  let listings = loadListings();
  if (department && department !== "all") {
    listings = listings.filter((listing) => listing.department === department);
  }
  return NextResponse.json(listings);
}
