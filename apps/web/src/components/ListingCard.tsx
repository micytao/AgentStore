"use client";

import type { Listing } from "@agentstore/shared";
import { departmentLabel } from "@agentstore/shared";
import {
  ChartLineIcon,
  CodeIcon,
  CommentsIcon,
  DollarSignIcon,
  ShieldAltIcon,
} from "@patternfly/react-icons";
import Link from "next/link";
import type { ComponentType } from "react";
import { DEPARTMENT_ACCENT } from "@/lib/accents";
import { modeLabel } from "@/lib/format";

const ICONS: Record<string, ComponentType> = {
  code: CodeIcon,
  comments: CommentsIcon,
  shield: ShieldAltIcon,
  chart: ChartLineIcon,
  money: DollarSignIcon,
};

export function ListingCard({ listing }: { listing: Listing }) {
  const Icon = ICONS[listing.icon] ?? CodeIcon;
  const disabled = Boolean(listing.comingSoon);
  const accent = DEPARTMENT_ACCENT[listing.department];
  const mode = listing.supportedModes[0];

  const inner = (
    <>
      <div className="store-card-top">
        <span className={`store-card-icon accent-${accent}`}>
          <Icon />
        </span>
        <span className="store-card-dept">{departmentLabel(listing.department)}</span>
      </div>
      <h3 className="store-card-title">{listing.name}</h3>
      <p className="store-card-copy">{listing.description}</p>
      <div className="store-card-meta">
        <span className={`store-pill mode-${mode === "work-with-me" ? "live" : "auto"}`}>
          {modeLabel(mode)}
        </span>
        <span className={`store-pill risk-${listing.riskTier}`}>
          {listing.riskTier} risk
        </span>
      </div>
      <div className="store-card-cta">
        {disabled ? "Coming soon" : "Launch →"}
      </div>
    </>
  );

  if (disabled) {
    return <article className="store-card is-disabled">{inner}</article>;
  }

  return (
    <Link href={`/listings/${listing.id}`} className="store-card-link">
      <article className="store-card">{inner}</article>
    </Link>
  );
}
