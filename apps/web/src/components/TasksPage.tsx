"use client";

import { departmentLabel } from "@agentstore/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Alert,
  Bullseye,
  Content,
  ContentVariants,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Button,
  PageSection,
  Spinner,
  Title,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import { PhaseLabel } from "@/components/PhaseLabel";
import { fetchTasks, type Task } from "@/lib/api";
import { formatUsd, modeLabel } from "@/lib/format";

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetchTasks()
        .then(setTasks)
        .catch((err: Error) => setError(err.message));
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <PageSection variant="secondary">
        <Content component={ContentVariants.small}>Across every department</Content>
        <Title headingLevel="h1" size="2xl">
          My tasks
        </Title>
        <Content component={ContentVariants.p}>
          Live sessions, drafts waiting on you, and everything you have
          already approved.
        </Content>
      </PageSection>

      <PageSection>
        {!tasks && !error ? (
          <Bullseye>
            <Spinner aria-label="Loading tasks" />
          </Bullseye>
        ) : error ? (
          <Alert variant="danger" isInline title="Could not load tasks">
            {error}
          </Alert>
        ) : tasks && tasks.length === 0 ? (
          <EmptyState titleText="No tasks yet" headingLevel="h2">
            <EmptyStateBody>
              Launch an agent from the catalog to see it here.
            </EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" component={(props) => <Link {...props} href="/" />}>
                  Browse catalog
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        ) : (
          <Table aria-label="My tasks">
            <Thead>
              <Tr>
                <Th>Agent</Th>
                <Th>Department · Mode</Th>
                <Th>Status</Th>
                <Th>Est. cost</Th>
                <Th>Launched</Th>
              </Tr>
            </Thead>
            <Tbody>
              {tasks?.map((task) => (
                <Tr
                  key={task.id}
                  isClickable
                  onRowClick={() => window.location.assign(`/tasks/${task.id}`)}
                >
                  <Td dataLabel="Agent">
                    <Link href={`/tasks/${task.id}`}>{task.listingName}</Link>
                  </Td>
                  <Td dataLabel="Department · Mode">
                    {departmentLabel(task.department)} · {modeLabel(task.mode)}
                  </Td>
                  <Td dataLabel="Status">
                    <PhaseLabel phase={task.status.phase} />
                  </Td>
                  <Td dataLabel="Est. cost">{formatUsd(task.status.costEstimate ?? 0)}</Td>
                  <Td dataLabel="Launched">{new Date(task.createdAt).toLocaleString()}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>
    </>
  );
}
