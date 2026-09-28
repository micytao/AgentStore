import { NextResponse } from "next/server";
import type { ListingUpdate } from "@agentstore/shared";
import { requireAdmin } from "@/server/auth";
import { deleteListing, getListing, updateListing } from "@/server/catalog";
import { stopDeployment } from "@/server/deployments";
import { stopOpenShellSession } from "@/server/openshellDeploy";

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

/** Best-effort teardown of whatever live infra this listing owns, run
 * before the catalog entry itself is removed — otherwise "Delete" only
 * ever hid the listing while its Deployment/Route (generic-chat) or
 * sandbox session (openshell) kept running forever, orphaned with no
 * catalog entry left to manage or even see it from. Failures here (e.g.
 * AAP/cluster unreachable) are reported back as a `warning` instead of
 * blocking the delete — the catalog entry is the source of truth for
 * "should this exist", so it must always be removable even if the infra
 * call fails; the warning tells the admin to clean up manually. */
async function teardownLiveInfra(id: string): Promise<string | undefined> {
  const listing = getListing(id);
  if (!listing) return undefined;

  try {
    if (listing.runtime === "generic-chat" && listing.deployment) {
      await stopDeployment(id);
    } else if (listing.runtime === "openshell" && listing.openshellSession) {
      await stopOpenShellSession(id);
    }
    return undefined;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Deleted "${listing.name}" from the catalog, but tearing down its running deployment failed (${detail}). It may still exist on OpenShift — clean it up manually.`;
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const warning = await teardownLiveInfra(id);
    deleteListing(id);
    return NextResponse.json({ ok: true, warning });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
