import { NextResponse } from "next/server";
import type { ListingCreateInput } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { createListing } from "@/server/catalog";

export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const body = (await request.json()) as ListingCreateInput;
  if (!body.name || !body.department || !body.category || !body.description) {
    return NextResponse.json(
      { error: "name, department, category, and description are required" },
      { status: 400 }
    );
  }
  if (!body.supportedModes || body.supportedModes.length === 0) {
    return NextResponse.json(
      { error: "At least one supported mode is required" },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(createListing(body));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
