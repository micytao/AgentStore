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
import { formatPrice, modeLabel } from "@/lib/format";

const ICONS: Record<string, ComponentType> = {
  code: CodeIcon,
  comments: CommentsIcon,
  shield: ShieldAltIcon,
  chart: ChartLineIcon,
  money: DollarSignIcon,
};

export function ListingCard({ listing }: { listing: Listing }) {
  const Icon = ICONS[listing.icon] ?? CodeIcon;
  const accent = DEPARTMENT_ACCENT[listing.department];
  const mode = listing.supportedModes[0];

  return (
    <Link href={`/listings/${listing.id}`} className="store-card-link">
      <article className="store-card">
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
          {listing.pricing && (
            <span className="store-pill is-price">{formatPrice(listing.pricing)}</span>
          )}
        </div>
        <div className="store-card-cta">Launch →</div>
      </article>
    </Link>
  );
}
