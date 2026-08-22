"use client";

import { departmentLabel, type AgentMode, type Listing } from "@agentstore/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createTask, fetchListing } from "@/lib/api";
import { DEPARTMENT_ACCENT } from "@/lib/accents";
import { modeLabel } from "@/lib/format";
import {
  ChartLineIcon,
  CodeIcon,
  CommentsIcon,
  DollarSignIcon,
  ShieldAltIcon,
} from "@patternfly/react-icons";
import type { ComponentType } from "react";
import Link from "next/link";

const ICONS: Record<string, ComponentType> = {
  code: CodeIcon,
  comments: CommentsIcon,
  shield: ShieldAltIcon,
  chart: ChartLineIcon,
  money: DollarSignIcon,
};

export function LaunchPage({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gitUrl, setGitUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchListing(listingId)
      .then(setListing)
      .catch((err: Error) => setError(err.message));
  }, [listingId]);

  if (error && !listing) {
    return (
      <div className="store-page">
        <p className="store-empty">{error}</p>
      </div>
    );
  }
  if (!listing) {
    return (
      <div className="store-page">
        <div className="store-loading">Loading listing…</div>
      </div>
    );
  }

  const current = listing;
  const mode: AgentMode = current.supportedModes[0];
  const interactive = mode === "work-with-me";
  const Icon = ICONS[current.icon] ?? CodeIcon;
  const accent = DEPARTMENT_ACCENT[current.department];
  const canLaunch = interactive || goal.trim().length > 8;

  async function onLaunch() {
    setSubmitting(true);
    setError(null);
    try {
      const task = await createTask({
        listingId: current.id,
        mode,
        gitUrl: gitUrl || undefined,
        target: interactive
          ? undefined
          : {
              goal: goal.trim(),
              successCriteria: successCriteria.trim() || undefined,
            },
      });
      router.push(`/tasks/${task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="store-page store-page-narrow">
      <Link href="/" className="store-back">
        ← Catalog
      </Link>
      <section className="store-launch-hero">
        <span className={`store-card-icon accent-${accent} is-lg`}>
          <Icon />
        </span>
        <div>
          <p className="store-kicker">
            {departmentLabel(listing.department)} · {listing.category}
          </p>
          <h1 className="store-launch-title">{listing.name}</h1>
          <p className="store-lede tight">{listing.description}</p>
          <div className="store-card-meta">
            <span className={`store-pill mode-${interactive ? "live" : "auto"}`}>
              {modeLabel(mode)}
            </span>
            <span className={`store-pill risk-${listing.riskTier}`}>
              {listing.riskTier} risk
            </span>
          </div>
        </div>
      </section>

      <section className="store-panel">
        {error ? <p className="store-banner is-error">{error}</p> : null}
        {interactive ? (
          <label className="store-field">
            <span>Repository URL</span>
            <em>optional</em>
            <input
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/example/billing-service"
            />
          </label>
        ) : (
          <>
            <label className="store-field">
              <span>Goal</span>
              <em>required</em>
              <textarea
                rows={5}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={
                  current.id === "support-ticket-draft"
                    ? "Draft a reply to INC-1042 about a billing outage"
                    : "What should the agent accomplish?"
                }
              />
            </label>
            <label className="store-field">
              <span>Success criteria</span>
              <em>optional</em>
              <input
                value={successCriteria}
                onChange={(e) => setSuccessCriteria(e.target.value)}
                placeholder="A review-ready draft the customer could receive"
              />
            </label>
          </>
        )}
        <div className="store-actions">
          <button
            type="button"
            className="store-btn-primary"
            disabled={!canLaunch || submitting}
            onClick={() => void onLaunch()}
          >
            {submitting ? "Launching…" : "Launch agent"}
          </button>
        </div>
      </section>
    </div>
  );
}
