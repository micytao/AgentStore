import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { PlatformSettings } from "@agentstore/shared";
import { getDataDir, importSecrets } from "@/server/secrets";
import { savePlatformSettings } from "@/server/platform";
import {
  writeCatalogOverrides,
  writeCustomListings,
  writeDeletedListings,
  writeProviders,
} from "@/server/dataDirFiles";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/sync
 *
 * Accepts a full state payload from the local AgentStore and writes
 * it to the on-cluster .data/ directory.  Authenticated by the
 * AGENTSTORE_SYNC_TOKEN env var injected during deploy.
 *
 * Used for "Sync to Cluster" (live push) after the initial deploy.
 */
export async function POST(request: Request) {
  const denied = requireSyncToken(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as SyncPayload;

    // --- Platform settings: merge config, preserve deploy status --------
    // Uses savePlatformSettings() which updates the in-memory cache AND
    // hydrates process.env (applyPlatformEnv), so the running process
    // picks up the new AAP/OCP URLs immediately — not just on next restart.
    if (body.platformSettings) {
      const dataDir = getDataDir();
      const filePath = path.join(dataDir, "platform.json");

      let existing: Partial<PlatformSettings> = {};
      if (fs.existsSync(filePath)) {
        try {
          existing = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PlatformSettings>;
        } catch {
          existing = {};
        }
      }

      const merged: Partial<PlatformSettings> = {
        ...body.platformSettings,
        // Preserve cluster-owned deploy status blobs
        agentstoreDeploy: existing.agentstoreDeploy,
        rhdhDeploy: existing.rhdhDeploy,
        eeBuild: existing.eeBuild,
        agentRuntimeBuild: existing.agentRuntimeBuild,
        agentSandboxServiceInstall: existing.agentSandboxServiceInstall,
        aapBootstrap: existing.aapBootstrap,
        openshellGatewayDeployment: existing.openshellGatewayDeployment,
      };

      savePlatformSettings(merged);
    }

    // --- Secrets: import plaintext into local vault ---------------------
    // importSecrets() writes to the vault file AND updates process.env
    // for known secret slots (AAP_TOKEN, OPENSHIFT_TOKEN, etc.)
    if (body.secrets && Object.keys(body.secrets).length > 0) {
      importSecrets(body.secrets);
    }

    // --- Catalog overrides: replace ------------------------------------
    if (body.catalogOverrides) {
      writeCatalogOverrides(body.catalogOverrides);
    }

    // --- Deleted listings: replace -------------------------------------
    if (body.deletedListings) {
      writeDeletedListings(body.deletedListings);
    }

    // --- Providers: replace --------------------------------------------
    if (body.providers) {
      writeProviders(body.providers);
    }

    // --- Custom listings: replace --------------------------------------
    if (body.customListings && Object.keys(body.customListings).length > 0) {
      writeCustomListings(body.customListings);
    }

    return NextResponse.json({ ok: true, syncedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncPayload {
  platformSettings?: Partial<PlatformSettings>;
  secrets?: Record<string, string>;
  catalogOverrides?: Record<string, unknown>;
  deletedListings?: string[];
  providers?: unknown[];
  customListings?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function requireSyncToken(request: Request): NextResponse | null {
  const expected = process.env.AGENTSTORE_SYNC_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Sync is not enabled — AGENTSTORE_SYNC_TOKEN is not set on this instance." },
      { status: 403 },
    );
  }

  const provided =
    request.headers.get("x-sync-token") ??
    request.headers.get("authorization")?.replace("Bearer ", "");

  if (provided !== expected) {
    return NextResponse.json(
      { error: "Invalid sync token." },
      { status: 401 },
    );
  }

  return null;
}
