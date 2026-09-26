"use client";

import { departmentLabel, splitSkillsFooter } from "@agentstore/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CodeBlock,
  CodeBlockCode,
  Content,
  ContentVariants,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Label,
  PageSection,
  ProgressStep,
  ProgressStepper,
  Spinner,
  Title,
} from "@patternfly/react-core";
import { LiveTerminal } from "@/components/LiveTerminal";
import { PhaseLabel } from "@/components/PhaseLabel";
import { SimulatedTerminal } from "@/components/SimulatedTerminal";
import {
  approveTask,
  cancelTask,
  fetchTask,
  rejectTask,
  type Task,
} from "@/lib/api";
import { formatUsd, modeLabel } from "@/lib/format";

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchTask(taskId)
        .then((next) => {
          if (!cancelled) setTask(next);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        });
    load();
    const timer = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId]);

  async function run(action: () => Promise<Task>) {
    setBusy(true);
    setError(null);
    try {
      setTask(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!task && !error) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Opening session" />
        </Bullseye>
      </PageSection>
    );
  }
  if (!task) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Task not found">
          {error}
        </Alert>
      </PageSection>
    );
  }

  const interactive = task.mode === "work-with-me";
  const awaiting = task.status.phase === "AwaitingApproval";
  const running = task.status.phase === "Running";
  const provisioning =
    task.status.phase === "Provisioning" || task.status.phase === "Pending";
  const canStop =
    task.status.phase === "Running" ||
    task.status.phase === "Provisioning" ||
    task.status.phase === "Pending";

  const backendLabel =
    task.status.backend === "aap"
      ? "Live AAP"
      : task.status.backend === "simulated"
        ? "Simulated AAP"
        : task.status.live
          ? "Live sandbox"
          : "Simulated";

  return (
    <PageSection isWidthLimited>
      <Link href="/tasks" className="store-back">
        ← My tasks
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", margin: "0.5rem 0 1.25rem" }}>
        <div>
          <Content component={ContentVariants.small}>
            {departmentLabel(task.department)} · {task.requestedBy}
          </Content>
          <Title headingLevel="h1" size="2xl">
            {task.listingName}
          </Title>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <PhaseLabel phase={task.status.phase} />
          <Label color={task.status.live ? "green" : "grey"} isCompact>
            {backendLabel}
          </Label>
        </div>
      </div>

      {error ? (
        <Alert variant="danger" isInline title="Something went wrong" style={{ marginBottom: "1rem" }}>
          {error}
        </Alert>
      ) : null}
      {task.status.error ? (
        <Alert variant="danger" isInline title="Task error" style={{ marginBottom: "1rem" }}>
          {task.status.error}
        </Alert>
      ) : null}
      {task.approvalDecision ? (
        <Alert
          variant={task.approvalDecision === "approved" ? "success" : "info"}
          isInline
          title={
            task.approvalDecision === "approved"
              ? "Approved. The draft was accepted — nothing was sent outside the store."
              : "Rejected. The draft was discarded."
          }
          style={{ marginBottom: "1rem" }}
        />
      ) : null}

      <DescriptionList isHorizontal style={{ marginBottom: "1.5rem" }}>
        <DescriptionListGroup>
          <DescriptionListTerm>Mode</DescriptionListTerm>
          <DescriptionListDescription>{modeLabel(task.mode)}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Est. cost</DescriptionListTerm>
          <DescriptionListDescription>{formatUsd(task.status.costEstimate ?? 0)}</DescriptionListDescription>
        </DescriptionListGroup>
        {task.gitUrl ? (
          <DescriptionListGroup>
            <DescriptionListTerm>Repository</DescriptionListTerm>
            <DescriptionListDescription>{task.gitUrl}</DescriptionListDescription>
          </DescriptionListGroup>
        ) : null}
        {task.target?.goal ? (
          <DescriptionListGroup>
            <DescriptionListTerm>Goal</DescriptionListTerm>
            <DescriptionListDescription>{task.target.goal}</DescriptionListDescription>
          </DescriptionListGroup>
        ) : null}
      </DescriptionList>

      {task.status.backend === "aap" || task.status.backend === "simulated" || task.status.aapJobId ? (
        <ProgressStepper aria-label="Provisioning timeline" style={{ marginBottom: "1.5rem" }}>
          <ProgressStep
            variant="success"
            id="aap-job"
            titleId="aap-job-title"
            aria-label="AAP job step"
          >
            <strong>{task.status.backend === "aap" ? "AAP job" : "Simulated AAP job"}</strong>
            <br />
            {task.status.aapJobId ?? "pending"}
            {task.status.provisioningStep ? ` · ${task.status.provisioningStep}` : ""}
            {task.status.aapJobUrl ? (
              <>
                {" "}
                <a href={task.status.aapJobUrl} target="_blank" rel="noreferrer">
                  Open in AAP
                </a>
              </>
            ) : null}
          </ProgressStep>
          <ProgressStep
            variant={
              task.status.phase === "Running" ||
              task.status.phase === "AwaitingApproval" ||
              task.status.phase === "Completed"
                ? "success"
                : "pending"
            }
            isCurrent={provisioning}
            id="openshift-job"
            titleId="openshift-job-title"
            aria-label="OpenShift Job step"
          >
            <strong>OpenShift Job</strong>
            <br />
            {task.status.openshiftJobName
              ? `${task.status.openshiftJobName} (${task.status.namespace ?? "agent-workloads"})`
              : "waiting"}
            {task.status.openshiftConsoleUrl ? (
              <>
                {" "}
                <a href={task.status.openshiftConsoleUrl} target="_blank" rel="noreferrer">
                  Open in OpenShift
                </a>
              </>
            ) : null}
          </ProgressStep>
          <ProgressStep
            variant={
              task.status.phase === "AwaitingApproval" || task.status.phase === "Completed"
                ? "success"
                : "pending"
            }
            isCurrent={running}
            id="draft"
            titleId="draft-title"
            aria-label="Draft step"
          >
            <strong>Draft</strong>
            <br />
            {task.status.phase === "AwaitingApproval" || task.status.phase === "Completed"
              ? "Ready for review"
              : "Not yet"}
          </ProgressStep>
        </ProgressStepper>
      ) : null}

      {interactive && (running || provisioning) ? (
        <Card>
          <CardBody>
            {provisioning ? (
              <Bullseye>
                <Spinner size="md" aria-label="Provisioning" /> &nbsp;Provisioning an isolated session…
              </Bullseye>
            ) : task.status.interactive?.kind === "openshell" ? (
              <LiveTerminal taskId={task.id} listingName={task.listingName} />
            ) : (
              <SimulatedTerminal listingName={task.listingName} live={task.status.live} />
            )}
            {canStop ? (
              <Button
                variant="secondary"
                isDisabled={busy}
                onClick={() => void run(() => cancelTask(task.id))}
                style={{ marginTop: "0.75rem" }}
              >
                Stop session
              </Button>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {!interactive ? (
        <Card>
          <CardBody>
            {provisioning || task.status.phase === "Running" ? (
              <Bullseye>
                <Spinner size="md" aria-label="Working" /> &nbsp;Working on your goal. You will
                approve the draft before anything ships.
              </Bullseye>
            ) : null}
            {task.status.outputSummary
              ? (() => {
                  const { draft, skillIds } = splitSkillsFooter(task.status.outputSummary);
                  return (
                    <>
                      <Title headingLevel="h2" size="md" style={{ marginBottom: "0.6rem" }}>
                        Draft output
                      </Title>
                      <CodeBlock>
                        <CodeBlockCode>{draft}</CodeBlockCode>
                      </CodeBlock>
                      {skillIds.length > 0 ? (
                        <Content component={ContentVariants.small} style={{ marginTop: "0.6rem" }}>
                          <strong>Skills used:</strong> {skillIds.join(", ")}
                        </Content>
                      ) : null}
                    </>
                  );
                })()
              : null}
            {awaiting ? (
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                <Button variant="primary" isDisabled={busy} onClick={() => void run(() => approveTask(task.id))}>
                  Approve
                </Button>
                <Button variant="secondary" isDisabled={busy} onClick={() => void run(() => rejectTask(task.id))}>
                  Reject
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </PageSection>
  );
}
