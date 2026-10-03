"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Bullseye,
  Content,
  ContentVariants,
  Flex,
  FlexItem,
  Label,
  PageSection,
  Spinner,
  Title,
} from "@patternfly/react-core";
import type { Listing } from "@agentstore/shared";
import { InlineTerminal } from "@/components/InlineTerminal";

/**
 * Public-facing listing launch page.  RHDH's "Launch Agent" links point
 * here for collaborative (openshell) agents.
 *
 * - openshell + session running  → shows agent info + inline terminal
 * - openshell + not running      → "Agent not yet available" alert
 * - autonomous + deployed        → redirects to agent's Route URL
 * - not found                    → 404 message
 */
export default function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [id, setId] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  // Unwrap the async params (Next.js 15 dynamic routes)
  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/listings?department=all`)
      .then((r) => r.json())
      .then((listings: Listing[]) => {
        const match = listings.find((l) => l.id === id);
        if (match) {
          setListing(match);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  // Redirect autonomous agents to their own Route URL
  useEffect(() => {
    if (!listing) return;
    if (
      listing.runtime !== "openshell" &&
      listing.deployment?.routeUrl
    ) {
      window.location.href = listing.deployment.routeUrl;
    }
  }, [listing]);

  if (loading) {
    return (
      <PageSection>
        <Bullseye style={{ minHeight: "60vh" }}>
          <Spinner aria-label="Loading agent" size="xl" />
        </Bullseye>
      </PageSection>
    );
  }

  if (notFound || !listing) {
    return (
      <PageSection>
        <Bullseye style={{ minHeight: "60vh" }}>
          <Alert variant="warning" isInline title="Agent not found">
            The requested agent listing does not exist.
          </Alert>
        </Bullseye>
      </PageSection>
    );
  }

  // Autonomous agent without a route — shouldn't normally happen via RHDH
  if (listing.runtime !== "openshell" && !listing.deployment?.routeUrl) {
    return (
      <PageSection>
        <Bullseye style={{ minHeight: "60vh" }}>
          <Alert variant="info" isInline title="Agent not yet deployed">
            This agent has not been deployed yet. Contact the platform team.
          </Alert>
        </Bullseye>
      </PageSection>
    );
  }

  // Openshell agent — show info + terminal
  const sessionRunning = listing.openshellSession?.status === "running";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--pf-t--global--background--color--primary--default)",
      }}
    >
      {/* Compact header */}
      <div
        style={{
          padding: "1rem 1.5rem",
          borderBottom:
            "1px solid var(--pf-t--global--border--color--default)",
          flexShrink: 0,
        }}
      >
        <Flex
          alignItems={{ default: "alignItemsCenter" }}
          spaceItems={{ default: "spaceItemsMd" }}
        >
          <FlexItem>
            <Title headingLevel="h1" size="xl">
              {listing.name}
            </Title>
          </FlexItem>
          <FlexItem>
            <Label color={sessionRunning ? "green" : "grey"}>
              {sessionRunning ? "Running" : listing.openshellSession?.status ?? "Not deployed"}
            </Label>
          </FlexItem>
        </Flex>
        <Content component={ContentVariants.small} style={{ marginTop: "0.25rem" }}>
          {listing.description}
        </Content>
      </div>

      {/* Terminal area */}
      <div style={{ flex: 1, minHeight: 0, padding: "0.75rem" }}>
        {sessionRunning ? (
          <InlineTerminal listingId={listing.id} />
        ) : (
          <Bullseye style={{ height: "100%" }}>
            <Alert
              variant="info"
              isInline
              title="Agent session is not running"
            >
              This agent&apos;s sandbox session has not been started yet.
              Contact the platform team to deploy it.
            </Alert>
          </Bullseye>
        )}
      </div>
    </div>
  );
}
