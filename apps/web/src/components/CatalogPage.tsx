"use client";

import { DEPARTMENTS } from "@agentstore/shared";
import { useEffect, useState } from "react";
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  Content,
  ContentVariants,
  EmptyState,
  EmptyStateBody,
  Gallery,
  Label,
  PageSection,
  Spinner,
  Title,
  ToggleGroup,
  ToggleGroupItem,
} from "@patternfly/react-core";
import { ListingCard } from "@/components/ListingCard";
import { fetchListings } from "@/lib/api";
import type { Listing } from "@agentstore/shared";

export function CatalogPage() {
  const [department, setDepartment] = useState("all");
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setListings(null);
    fetchListings(department)
      .then(setListings)
      .catch((err: Error) => setError(err.message));
  }, [department]);

  return (
    <>
      <PageSection variant="secondary">
        <Content>
          <Label
            color="red"
            style={{
              marginBottom: "0.6rem",
              fontWeight: 700,
              fontSize: "0.85rem",
              letterSpacing: "0.02em",
            }}
          >
            Self-service · Governed · Auditable
          </Label>
          <Title headingLevel="h1" size="2xl">
            Pick a job. We stand the agent up.
          </Title>
          <Content component={ContentVariants.p}>
            Browse business agents by department. Launch one, and Ansible
            Automation Platform provisions it onto the company OpenShift
            cluster. The platform handles the infrastructure — you just
            review the draft.
          </Content>
        </Content>
        <Gallery hasGutter minWidths={{ default: "18rem" }} style={{ marginTop: "1rem" }}>
          <Card isCompact>
            <CardTitle>
              <Label color="blue" isCompact>
                A
              </Label>{" "}
              Autonomous Mode
            </CardTitle>
            <CardBody>
              Do this for me. AAP stands up an OpenShift Job. The agent
              drafts; you approve before anything ships.
            </CardBody>
          </Card>
          <Card isCompact>
            <CardTitle>
              <Label color="purple" isCompact>
                C
              </Label>{" "}
              Collaborative Mode
            </CardTitle>
            <CardBody>
              Work with me. Engineering specialist agents (optional OpenShell
              sandbox) for live pairing — listed last in the catalog.
            </CardBody>
          </Card>
        </Gallery>
      </PageSection>

      <PageSection>
        <ToggleGroup aria-label="Department filter" style={{ marginBottom: "1.5rem" }}>
          {DEPARTMENTS.map((item) => (
            <ToggleGroupItem
              key={item.id}
              text={item.name}
              isSelected={department === item.id}
              onChange={() => setDepartment(item.id)}
            />
          ))}
        </ToggleGroup>

        {!listings && !error ? (
          <Bullseye>
            <Spinner aria-label="Loading catalog" />
          </Bullseye>
        ) : error ? (
          <Alert variant="danger" isInline title="Could not load catalog">
            {error}
          </Alert>
        ) : listings && listings.length === 0 ? (
          <EmptyState titleText="Nothing published here yet" headingLevel="h2">
            <EmptyStateBody>
              Ask an admin to publish an agent, or pick another department.
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Gallery hasGutter minWidths={{ default: "20rem" }}>
            {listings?.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </Gallery>
        )}
      </PageSection>
    </>
  );
}
