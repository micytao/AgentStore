"use client";

import { departmentLabel, type AgentMode, type Listing } from "@agentstore/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createTask, fetchListing } from "@/lib/api";
import { DEPARTMENT_ACCENT } from "@/lib/accents";
import { modeLabel } from "@/lib/format";
import {
  Alert,
  Bullseye,
  Button,
  Content,
  ContentVariants,
  Form,
  FormGroup,
  Icon,
  Label,
  LabelGroup,
  PageSection,
  Spinner,
  TextArea,
  TextInput,
  Title,
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
import type { ComponentType } from "react";
import Link from "next/link";

const ICONS: Record<string, ComponentType> = {
  code: CodeIcon,
  comments: CommentsIcon,
  shield: ShieldAltIcon,
  chart: ChartLineIcon,
  money: DollarSignIcon,
  headset: HeadsetIcon,
  server: ServerIcon,
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
      <PageSection>
        <Alert variant="danger" isInline title="Could not load listing">
          {error}
        </Alert>
      </PageSection>
    );
  }
  if (!listing) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading listing" />
        </Bullseye>
      </PageSection>
    );
  }

  const current = listing;
  const mode: AgentMode = current.mode;
  const interactive = mode === "work-with-me";
  const IconComponent = ICONS[current.icon] ?? CodeIcon;
  const accent = DEPARTMENT_ACCENT[current.department];
  const canLaunch = interactive || goal.trim().length > 8;
  const isGenericChat = current.runtime === "generic-chat";
  const deployment = current.deployment;

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

  // generic-chat agents are provisioned once by an admin (Deploy to
  // OpenShift), not per-launch — opening the link just logs a lightweight
  // audit Task and sends the user straight to the already-running chat UI,
  // instead of the goal-entry form used by hosted-agent-api/openshell.
  async function onOpenAgent() {
    if (!deployment?.routeUrl) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTask({ listingId: current.id, mode });
    } catch {
      // Best-effort audit log — a failed Task write shouldn't block opening
      // an agent that's demonstrably already running.
    } finally {
      setSubmitting(false);
    }
    window.open(deployment.routeUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <PageSection isWidthLimited>
      <Link href="/" className="store-back">
        ← Catalog
      </Link>

      <Content style={{ display: "flex", gap: "1.1rem", alignItems: "flex-start", margin: "1rem 0 1.5rem" }}>
        <Icon size="xl">
          <IconComponent />
        </Icon>
        <div>
          <Content component={ContentVariants.small}>
            {departmentLabel(listing.department)} · {listing.category}
          </Content>
          <Title headingLevel="h1" size="2xl">
            {listing.name}
          </Title>
          <Content component={ContentVariants.p}>{listing.description}</Content>
          <LabelGroup>
            <Label color={mode === "work-with-me" ? "purple" : "blue"} isCompact>
              {modeLabel(mode)}
            </Label>
            <Label color={listing.riskTier === "low" ? "green" : listing.riskTier === "medium" ? "orange" : "red"} isCompact>
              {listing.riskTier} risk
            </Label>
          </LabelGroup>
        </div>
      </Content>

      {error ? (
        <Alert variant="danger" isInline title="Something went wrong" style={{ marginBottom: "1rem" }}>
          {error}
        </Alert>
      ) : null}

      {isGenericChat ? (
        deployment?.status === "running" && deployment.routeUrl ? (
          <>
            <Content component={ContentVariants.p}>
              This agent is deployed and running. Opening it starts a private
              chat session in a new tab — your conversation isn&apos;t shared
              with other users.
            </Content>
            <Button variant="primary" isDisabled={submitting} onClick={() => void onOpenAgent()}>
              {submitting ? "Opening…" : "Open agent →"}
            </Button>
          </>
        ) : (
          <Alert variant="danger" isInline title="Agent not deployed">
            Ask an admin to deploy it from the Admin console (Catalog → Agent
            config → Deploy to OpenShift).
          </Alert>
        )
      ) : (
        <Form onSubmit={(e) => e.preventDefault()}>
          {interactive ? (
            <FormGroup label="Repository URL" fieldId="git-url">
              <TextInput
                id="git-url"
                value={gitUrl}
                onChange={(_e, value) => setGitUrl(value)}
                placeholder="https://github.com/example/billing-service"
              />
            </FormGroup>
          ) : (
            <>
              <FormGroup label="Goal" isRequired fieldId="goal">
                <TextArea
                  id="goal"
                  rows={5}
                  value={goal}
                  onChange={(_e, value) => setGoal(value)}
                  placeholder="What should the agent accomplish?"
                  resizeOrientation="vertical"
                />
              </FormGroup>
              <FormGroup label="Success criteria" fieldId="success-criteria">
                <TextInput
                  id="success-criteria"
                  value={successCriteria}
                  onChange={(_e, value) => setSuccessCriteria(value)}
                  placeholder="A review-ready draft the customer could receive"
                />
              </FormGroup>
            </>
          )}
          <FormGroup fieldId="launch-actions" hasNoPaddingTop>
            <Button variant="primary" isDisabled={!canLaunch || submitting} onClick={() => void onLaunch()}>
              {submitting ? "Launching…" : "Launch agent"}
            </Button>
          </FormGroup>
        </Form>
      )}
    </PageSection>
  );
}
