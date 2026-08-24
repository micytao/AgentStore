import type {
  EngineAdapter,
  EngineHandle,
  EngineStatus,
  TaskSpec,
} from "@agentstore/shared";

interface FakeSession {
  startedAt: number;
  terminated: boolean;
}

function sessions(): Map<string, FakeSession> {
  const g = globalThis as typeof globalThis & {
    __agentStoreFakeSessions?: Map<string, FakeSession>;
  };
  if (!g.__agentStoreFakeSessions) {
    g.__agentStoreFakeSessions = new Map();
  }
  return g.__agentStoreFakeSessions;
}

/** Canned per-listing draft text. Exported so apps/web can fall back to it when no
 * real model provider is configured (see apps/web/src/server/drafting.ts). */
export function draftFor(spec: TaskSpec): string {
  const goal = spec.target?.goal ?? "the assigned goal";

  if (spec.listingId === "support-ticket-draft") {
    return [
      `Subject: Re: ${goal}`,
      "",
      "Hi,",
      "",
      "Thank you for reporting this. We've identified the issue and a fix is in progress.",
      "You should see service restored shortly. We'll follow up if we need anything else from you.",
      "",
      "Sorry for the disruption,",
      "Customer Support",
      "",
      "— Draft only. Not sent. Approve to accept, or reject to discard.",
    ].join("\n");
  }

  if (spec.listingId === "cve-weekly-scan") {
    return [
      `Weekly CVE scan — ${goal}`,
      "",
      "Found 2 actionable findings in the last scan window:",
      "",
      "1. jackson-databind 2.15.3 — CVE-2024-25710 (High). Fix: bump to 2.17.1.",
      "2. golang.org/x/net — GO-2024-2942 (Medium). Fix: bump to v0.33.0.",
      "",
      "A draft pull request was prepared. It has not been opened.",
      "Approve to accept this report, or reject to discard it.",
    ].join("\n");
  }

  if (spec.listingId === "invoice-reconciliation") {
    return [
      `Invoice reconciliation — ${goal}`,
      "",
      "Matched 18 of 21 invoices to purchase orders this window.",
      "Exceptions:",
      "1. INV-8841 — amount $1,240 over PO-3301 (freight not on PO).",
      "2. INV-8902 — vendor ACME-EU, no matching PO in the last 90 days.",
      "3. INV-8910 — duplicate of INV-8877 (same hash, different invoice date).",
      "",
      "Draft exception pack for the finance lead. Approve to accept, or reject to discard.",
    ].join("\n");
  }

  if (spec.listingId === "data-dashboard-summary") {
    return [
      `Dashboard summary — ${goal}`,
      "",
      "North-star metric is up 4.2% week over week.",
      "Two pipelines slipped SLA (orders-ingest, tax-feed).",
      "Recommended follow-up: page the data-platform on-call for tax-feed; orders-ingest is a known backfill.",
      "",
      "Draft for stakeholder email. Approve to accept, or reject to discard.",
    ].join("\n");
  }

  return `Completed work toward: ${goal}\n\nThis is a simulated result. Approve or reject.`;
}

export class FakeEngineAdapter implements EngineAdapter {
  async provision(spec: TaskSpec): Promise<EngineHandle> {
    const sandboxId = `fake-${spec.taskId}`;
    sessions().set(sandboxId, { startedAt: Date.now(), terminated: false });
    return { engineType: "fake", sandboxId };
  }

  async getStatus(handle: EngineHandle, spec: TaskSpec): Promise<EngineStatus> {
    let session = sessions().get(handle.sandboxId);
    if (!session) {
      session = { startedAt: Date.now() - 5000, terminated: false };
      sessions().set(handle.sandboxId, session);
    }
    if (session.terminated) {
      return { phase: "Cancelled" };
    }

    const elapsed = Date.now() - session.startedAt;
    if (elapsed < 1200) {
      return { phase: "Provisioning" };
    }

    if (spec.mode === "work-with-me") {
      return {
        phase: "Running",
        interactive: {
          kind: "simulated",
          attachHint: "Client-side simulated terminal",
        },
      };
    }

    if (elapsed < 4500) {
      return { phase: "Running" };
    }

    return {
      phase: "AwaitingApproval",
      outputSummary: draftFor(spec),
    };
  }

  async exposeInteractiveEndpoint(handle: EngineHandle) {
    const session = sessions().get(handle.sandboxId);
    if (!session || session.terminated) return null;
    return { kind: "simulated" as const };
  }

  async terminate(handle: EngineHandle): Promise<void> {
    const session = sessions().get(handle.sandboxId);
    if (session) session.terminated = true;
  }
}

export const fakeEngine = new FakeEngineAdapter();
