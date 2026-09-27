"use client";

import { useEffect, useState } from "react";
import type {
  PlatformConnectionStatus,
  PlatformSettings,
  PlatformStatus,
  SecretSummary,
} from "@agentstore/shared";
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  Content,
  ContentVariants,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  Gallery,
  GalleryItem,
  Label,
  Spinner,
  TextInput,
  Title,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import { SecretField } from "@/components/SecretField";
import { fetchPlatformStatus, fetchSecrets, testPlatformConnection } from "@/lib/api";

type TestOutcome = { ok: boolean; message: string };

function TestBanner({ result, pending }: { result?: TestOutcome; pending?: boolean }) {
  if (pending) {
    return <Alert variant="info" isInline isPlain title="Testing connection…" />;
  }
  if (!result) return null;
  return <Alert variant={result.ok ? "success" : "danger"} isInline isPlain title={result.message} />;
}

function ConnectionCard({
  name,
  connection,
  url,
  details,
  result,
}: {
  name: string;
  connection: PlatformConnectionStatus;
  url?: string;
  details?: { label: string; value: string }[];
  result?: TestOutcome;
}) {
  const statusLabel = connection.connected
    ? "Connected"
    : connection.configured
      ? "Disconnected"
      : "Not configured";
  const statusColor: "green" | "red" | "grey" = connection.connected
    ? "green"
    : connection.configured
      ? "red"
      : "grey";
  const errorMessage = result && !result.ok ? result.message : connection.error;
  const showError = Boolean(errorMessage && !connection.connected);
  const showSuccess = Boolean(result?.ok);

  return (
    <Card isCompact>
      <CardTitle>{name}</CardTitle>
      <CardBody>
        <DescriptionList isCompact>
          <DescriptionListGroup>
            <DescriptionListTerm>Status</DescriptionListTerm>
            <DescriptionListDescription>
              <Label color={statusColor} isCompact>
                {statusLabel}
              </Label>
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>URL</DescriptionListTerm>
            <DescriptionListDescription>
              {url ? (
                <span title={url}>{url}</span>
              ) : (
                <Content component={ContentVariants.small}>Not configured</Content>
              )}
            </DescriptionListDescription>
          </DescriptionListGroup>
          {details?.map((item) => (
            <DescriptionListGroup key={item.label}>
              <DescriptionListTerm>{item.label}</DescriptionListTerm>
              <DescriptionListDescription>{item.value}</DescriptionListDescription>
            </DescriptionListGroup>
          ))}
        </DescriptionList>
        {showSuccess && (
          <Alert variant="success" isInline isPlain title={result!.message} style={{ marginTop: "0.5rem" }} />
        )}
        {showError && (
          <Alert variant="danger" isInline isPlain title={errorMessage} style={{ marginTop: "0.5rem" }} />
        )}
      </CardBody>
    </Card>
  );
}

export function PlatformPanel() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<"aap" | "openshift" | null>(null);
  const [testResults, setTestResults] = useState<{
    aap?: TestOutcome;
    openshift?: TestOutcome;
  }>({});

  function loadSecrets() {
    fetchSecrets()
      .then(setSecrets)
      .catch((err: Error) => setError(err.message));
  }

  function load() {
    fetchPlatformStatus()
      .then((next) => {
        setStatus(next);
        setDraft(next.settings);
      })
      .catch((err: Error) => setError(err.message));
    loadSecrets();
  }

  useEffect(load, []);

  function draftPatch(): PlatformSettings {
    const current = draft!;
    return {
      ...current,
      aapJobTemplateId:
        current.aapJobTemplateId === "" || current.aapJobTemplateId === undefined
          ? ""
          : Number(current.aapJobTemplateId),
    };
  }

  async function test(target: "aap" | "openshift") {
    if (!draft) return;
    setTesting(target);
    setTestResults((prev) => ({ ...prev, [target]: undefined }));
    try {
      const next = await testPlatformConnection(target, draftPatch());
      const conn = target === "aap" ? next.aap : next.openshift;
      const outcome: TestOutcome = conn?.connected
        ? {
            ok: true,
            message:
              target === "aap"
                ? "AAP controller is reachable."
                : "OpenShift API is reachable.",
          }
        : {
            ok: false,
            message: conn?.error ?? "Connection failed.",
          };
      setDraft(next.settings);
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              settings: next.settings,
              ...(next.aap ? { aap: next.aap } : {}),
              ...(next.openshift ? { openshift: next.openshift } : {}),
            }
          : prev
      );
      setTestResults((prev) => ({ ...prev, [target]: outcome }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [target]: { ok: false, message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setTesting(null);
    }
  }

  if (error && !status) return <Alert variant="danger" isInline title={error} />;
  if (!status || !draft) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading platform" />
      </Bullseye>
    );
  }

  function field<K extends keyof PlatformSettings>(key: K, label: string, placeholder = "") {
    const id = `platform-${key}`;
    return (
      <FormGroup label={label} fieldId={id}>
        <TextInput
          id={id}
          value={String(draft![key] ?? "")}
          placeholder={placeholder}
          onChange={(_e, v) => setDraft((prev) => (prev ? { ...prev, [key]: v } : prev))}
        />
      </FormGroup>
    );
  }

  function insecureTlsToggle<K extends "aapInsecureTls" | "openshiftInsecureTls">(key: K) {
    const id = `platform-${key}`;
    return (
      <Checkbox
        id={id}
        label="Allow self-signed certificate (dev/workshop clusters only)"
        isChecked={Boolean(draft![key])}
        onChange={(_e, checked) => setDraft((prev) => (prev ? { ...prev, [key]: checked } : prev))}
      />
    );
  }

  const aapToken = secrets.find((s) => s.key === "AAP_TOKEN");
  const openshiftToken = secrets.find((s) => s.key === "OPENSHIFT_TOKEN");

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }}>
      {error ? (
        <FlexItem>
          <Alert variant="danger" isInline title={error} />
        </FlexItem>
      ) : null}

      <FlexItem>
        <Card>
          <CardTitle>Connections</CardTitle>
          <CardBody>
            <Content component={ContentVariants.p}>
              AgentStore is a console. It talks to Ansible Automation Platform to
              provision, and to prod OpenShift to watch the Job that actually
              runs. URLs and tokens for both are configured below.
            </Content>
            <Gallery hasGutter minWidths={{ default: "300px" }}>
              <GalleryItem>
                <ConnectionCard
                  name="Ansible Automation Platform"
                  connection={status.aap}
                  url={status.aap.configured ? status.settings.aapControllerUrl : undefined}
                  result={testResults.aap}
                />
              </GalleryItem>
              <GalleryItem>
                <ConnectionCard
                  name="OpenShift (prod)"
                  connection={status.openshift}
                  url={status.openshift.configured ? status.settings.openshiftApiUrl : undefined}
                  details={
                    status.openshift.configured
                      ? [{ label: "Namespace", value: status.settings.openshiftNamespace || "agent-workloads" }]
                      : undefined
                  }
                  result={testResults.openshift}
                />
              </GalleryItem>
            </Gallery>
          </CardBody>
        </Card>
      </FlexItem>

      <FlexItem>
        <Card>
          <CardTitle>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>AAP controller</FlexItem>
              <FlexItem>
                <Button variant="secondary" isDisabled={testing !== null} onClick={() => void test("aap")}>
                  {testing === "aap" ? "Testing…" : "Test"}
                </Button>
              </FlexItem>
            </Flex>
          </CardTitle>
          <CardBody>
            <TestBanner result={testResults.aap} pending={testing === "aap"} />
            <Form>
              <Flex spaceItems={{ default: "spaceItemsMd" }}>
                <FlexItem flex={{ default: "flex_1" }}>
                  {field("aapControllerUrl", "Controller URL", "https://aap.example.com")}
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }}>
                  {field("aapConsoleUrl", "Console URL (deep links)", "https://aap.example.com")}
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }}>{field("aapJobTemplateId", "Default job template id", "42")}</FlexItem>
              </Flex>
            </Form>
            {status.aap.jobTemplates.length > 0 ? (
              <Content component={ContentVariants.small}>
                Templates:{" "}
                {status.aap.jobTemplates
                  .slice(0, 8)
                  .map((t) => `${t.name} (#${t.id})`)
                  .join(" · ")}
              </Content>
            ) : null}
            {insecureTlsToggle("aapInsecureTls")}
            {aapToken && <SecretField secret={aapToken} onChange={loadSecrets} />}
          </CardBody>
        </Card>
      </FlexItem>

      <FlexItem>
        <Card>
          <CardTitle>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>Prod OpenShift</FlexItem>
              <FlexItem>
                <Button variant="secondary" isDisabled={testing !== null} onClick={() => void test("openshift")}>
                  {testing === "openshift" ? "Testing…" : "Test"}
                </Button>
              </FlexItem>
            </Flex>
          </CardTitle>
          <CardBody>
            <TestBanner result={testResults.openshift} pending={testing === "openshift"} />
            <Content component={ContentVariants.small}>
              This must be the <strong>API server</strong> URL, not the web console — usually{" "}
              <code>https://api.&lt;cluster-domain&gt;:6443</code>. It is a different hostname from the console
              (which starts with <code>console-openshift-console.apps.</code>) and almost always needs an explicit
              <code>:6443</code> port.
            </Content>
            <Form>
              <Flex spaceItems={{ default: "spaceItemsMd" }}>
                <FlexItem flex={{ default: "flex_1" }}>
                  {field("openshiftApiUrl", "API URL", "https://api.cluster.example.com:6443")}
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }}>{field("openshiftNamespace", "Namespace", "agent-workloads")}</FlexItem>
                <FlexItem flex={{ default: "flex_1" }}>
                  {field("openshiftConsoleUrl", "Console URL", "https://console-openshift-console.apps.example.com")}
                </FlexItem>
              </Flex>
            </Form>
            {insecureTlsToggle("openshiftInsecureTls")}
            {openshiftToken && <SecretField secret={openshiftToken} onChange={loadSecrets} />}
          </CardBody>
        </Card>
      </FlexItem>

      <FlexItem>
        <Card>
          <CardTitle>Recent AAP jobs</CardTitle>
          <CardBody>
            {status.aap.recentJobs.length === 0 ? (
              <Content component={ContentVariants.small}>No jobs yet — or AAP is not connected.</Content>
            ) : (
              <Table aria-label="Recent AAP jobs" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Job</Th>
                    <Th>Status</Th>
                    <Th>Link</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {status.aap.recentJobs.map((job) => (
                    <Tr key={job.id}>
                      <Td dataLabel="Job">
                        #{job.id} {job.name}
                      </Td>
                      <Td dataLabel="Status">
                        <Label isCompact>{job.status}</Label>
                      </Td>
                      <Td dataLabel="Link">
                        {job.url ? (
                          <a href={job.url} target="_blank" rel="noreferrer">
                            Open in AAP
                          </a>
                        ) : (
                          job.started ?? ""
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </FlexItem>

      <FlexItem>
        <Card>
          <CardTitle>Agent Jobs on OpenShift</CardTitle>
          <CardBody>
            {status.openshift.jobs.length === 0 ? (
              <Content component={ContentVariants.small}>
                No <code>agent-*</code> Jobs in {status.settings.openshiftNamespace || "agent-workloads"}.
              </Content>
            ) : (
              <Table aria-label="Agent jobs on OpenShift" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Job</Th>
                    <Th>Namespace</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {status.openshift.jobs.map((job) => {
                    const statusLabel = job.succeeded ? "succeeded" : job.failed ? "failed" : job.active ? "active" : "pending";
                    const statusColor: "green" | "red" | "blue" | "grey" = job.succeeded
                      ? "green"
                      : job.failed
                        ? "red"
                        : job.active
                          ? "blue"
                          : "grey";
                    return (
                      <Tr key={`${job.namespace}/${job.name}`}>
                        <Td dataLabel="Job">
                          {job.name}
                          {job.taskId ? ` · task ${job.taskId}` : ""}
                        </Td>
                        <Td dataLabel="Namespace">{job.namespace}</Td>
                        <Td dataLabel="Status">
                          <Label color={statusColor} isCompact>
                            {statusLabel}
                          </Label>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </FlexItem>
    </Flex>
  );
}
