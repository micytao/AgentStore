"use client";

import type { Listing } from "@agentstore/shared";
import { departmentLabel } from "@agentstore/shared";
import {
  Card,
  CardBody,
  CardFooter,
  CardTitle,
  Icon,
  Label,
  LabelGroup,
} from "@patternfly/react-core";
import {
  ChartLineIcon,
  CodeIcon,
  CommentsIcon,
  DollarSignIcon,
  HeadsetIcon,
  ServerIcon,
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
  headset: HeadsetIcon,
  server: ServerIcon,
};

const RISK_COLOR: Record<Listing["riskTier"], "green" | "orange" | "red"> = {
  low: "green",
  medium: "orange",
  high: "red",
};

export function ListingCard({ listing }: { listing: Listing }) {
  const IconComponent = ICONS[listing.icon] ?? CodeIcon;
  const accent = DEPARTMENT_ACCENT[listing.department];
  const mode = listing.mode;
  const isRunningGenericChat =
    listing.runtime === "generic-chat" && listing.deployment?.status === "running";

  return (
    <Link href={`/listings/${listing.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <Card isCompact isClickable isFullHeight>
        <CardTitle>
          <Icon size="lg" style={{ marginRight: "0.6rem" }}>
            <IconComponent />
          </Icon>
          {listing.name}
        </CardTitle>
        <CardBody>
          <Label color={accent} isCompact style={{ marginBottom: "0.6rem" }}>
            {departmentLabel(listing.department)}
          </Label>
          <p>{listing.description}</p>
        </CardBody>
        <CardFooter>
          <LabelGroup>
            <Label color={mode === "work-with-me" ? "purple" : "blue"} isCompact>
              {modeLabel(mode)}
            </Label>
            <Label color={RISK_COLOR[listing.riskTier]} isCompact>
              {listing.riskTier} risk
            </Label>
            {listing.pricing && <Label isCompact>{formatPrice(listing.pricing)}</Label>}
          </LabelGroup>
          <div style={{ marginTop: "0.75rem", fontWeight: 600 }}>
            {isRunningGenericChat ? "Open agent →" : "Launch →"}
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}
