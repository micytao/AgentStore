"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  ContentVariants,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  InputGroup,
  InputGroupItem,
  Label,
  Spinner,
  TextInput,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import {
  departmentLabel,
  type GatewayWorkloadKind,
  type Listing,
  type SecretSummary,
} from "@agentstore/shared";
import { SecretField } from "@/components/SecretField";
import {
  deployGateway,
  fetchEngineSettings,
  fetchGatewayStatus,
  fetchListings,
  fetchPlatformStatus,
  fetchSecrets,
  updatePlatformSettings,
  type EngineSettings,
  type PlatformStatus,
} from "@/lib/api";

/** OpenShell settings: onboarding the gateway Helm chart, monitoring the
 * Agent Sandbox Service the console talks to, and which listings are
 * wired to it. Its own top-level Settings page (see
 * app/admin/openshell/page.tsx) — previously an internal LLMs sub-tab,
 * promoted alongside Platform/LLMs/Skills since it's a full deploy
 * surface in its own right, not just an LLM concern. */
export function OpenShellPanel() {
  const [settings, setSettings] = useState<EngineSettings | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [platform, setPlatform] = useState<PlatformStatus | null>(null);
  const [serviceUrlDraft, setServiceUrlDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Onboard gateway card — admin-supplied Helm chart ref + install params,
  // defaulting to NVIDIA's real published chart. Drafts mirror the
  // corresponding PlatformSettings fields; saved via the same PATCH
  // updatePlatformSettings() other Platform-tab fields use.
  const [gatewayChartRef, setGatewayChartRef] = useState("");
  const [gatewayChartVersion, setGatewayChartVersion] = useState("");
  const [gatewayNamespace, setGatewayNamespace] = useState("");
  const [gatewayWorkloadKind, setGatewayWorkloadKind] = useState<GatewayWorkloadKind>("statefulset");
  const [gatewayJobTemplateId, setGatewayJobTemplateId] = useState("");
  const [savingGateway, setSavingGateway] = useState(false);
  const [deployingGateway, setDeployingGateway] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  function loadSecrets() {
    fetchSecrets()
      .then(setSecrets)
      .catch((err: Error) => setError(err.message));
  }

  function load() {
    Promise.all([fetchEngineSettings(), fetchListings(), fetchPlatformStatus()])
      .then(([nextSettings, nextListings, nextPlatform]) => {
        setSettings(nextSettings);
        setListings(nextListings);
        setPlatform(nextPlatform);
        setServiceUrlDraft(nextPlatform.settings.openshellServiceUrl);
        setGatewayChartRef(nextPlatform.settings.openshellGatewayChartRef);
        setGatewayChartVersion(nextPlatform.settings.openshellGatewayChartVersion);
        setGatewayNamespace(nextPlatform.settings.openshellGatewayNamespace);
        setGatewayWorkloadKind(nextPlatform.settings.openshellGatewayWorkloadKind);
        setGatewayJobTemplateId(String(nextPlatform.settings.openshellGatewayJobTemplateId || ""));
      })
      .catch((err: Error) => setError(err.message));
    loadSecrets();
  }

  useEffect(load, []);

  const gatewayDeployment = platform?.settings.openshellGatewayDeployment;

  // Poll while the gateway install is in flight — same interval-polling
  // pattern ListingRow uses for the generic-chat deploy flow.
  useEffect(() => {
    if (gatewayDeployment?.status !== "deploying") return;
    const timer = setInterval(() => {
      fetchGatewayStatus()
        .then((nextSettings) => {
          setPlatform((prev) => (prev ? { ...prev, settings: nextSettings } : prev));
        })
        .catch((err: Error) => setGatewayError(err.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [gatewayDeployment?.status]);

  async function saveServiceUrl() {
    setSaving(true);
    setError(null);
    try {
      const next = await updatePlatformSettings({ openshellServiceUrl: serviceUrlDraft });
      setPlatform(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveGatewaySettings() {
    setSavingGateway(true);
    setGatewayError(null);
    try {
      const next = await updatePlatformSettings({
        openshellGatewayChartRef: gatewayChartRef,
        openshellGatewayChartVersion: gatewayChartVersion,
        openshellGatewayNamespace: gatewayNamespace,
        openshellGatewayWorkloadKind: gatewayWorkloadKind,
        openshellGatewayJobTemplateId: gatewayJobTemplateId.trim() ? Number(gatewayJobTemplateId) : "",
      });
      setPlatform(next);
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingGateway(false);
    }
  }

  async function deployGatewayNow() {
    setDeployingGateway(true);
    setGatewayError(null);
    try {
      await saveGatewaySettings();
      const nextSettings = await deployGateway();
      setPlatform((prev) => (prev ? { ...prev, settings: nextSettings } : prev));
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeployingGateway(false);
    }
  }

  if (error) return <Alert variant="danger" isInline title={error} />;
  if (!settings || !listings || !platform) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading OpenShell settings" />
      </Bullseye>
    );
  }

  const wired = listings.filter((listing) => listing.openshellAgent);
  const serviceToken = secrets.find((s) => s.key === "OPENSHELL_SERVICE_TOKEN");
  const gitPat = secrets.find((s) => s.key === "GIT_PAT");
  const gatewayStatusColor: "green" | "red" | "grey" =
    gatewayDeployment?.status === "running" ? "green" : gatewayDeployment?.status === "failed" ? "red" : "grey";

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }}>
      <FlexItem>
        <Card>
          <CardTitle>Onboard the OpenShell gateway</CardTitle>
          <CardBody>
            <Content component={ContentVariants.small}>
              NVIDIA OpenShell is the real sandboxing runtime the Agent Sandbox
              Service below talks to. Installing it is a live{" "}
              <code>helm upgrade --install</code> against the chart reference
              below, run once via AAP — the console never runs Helm itself. See{" "}
              <a href="https://docs.nvidia.com/openshell/kubernetes/openshift" target="_blank" rel="noreferrer">
                docs.nvidia.com/openshell/kubernetes/openshift
              </a>
              .
            </Content>
            <Content component={ContentVariants.small}>
              <strong>Before you deploy:</strong> the cluster-scoped Agent Sandbox
              controller + CRDs are a separate, one-time, elevated-privilege
              prerequisite this job intentionally does not install — a
              platform admin applies those once per cluster, outside this
              self-service flow. See <em>deploy/openshift/README.md</em> for the exact command.
            </Content>

            {gatewayDeployment && (
              <Card isCompact style={{ marginTop: "1rem" }}>
                <CardBody>
                  <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsFlexStart" }}>
                    <FlexItem>
                      <strong>{gatewayDeployment.releaseName ?? "openshell"}</strong>
                      <Content component={ContentVariants.small}>
                        {gatewayDeployment.namespace} · {gatewayDeployment.chartRef}
                        {gatewayDeployment.chartVersion ? `@${gatewayDeployment.chartVersion}` : ""} ·{" "}
                        {gatewayDeployment.workloadKind}
                      </Content>
                    </FlexItem>
                    <FlexItem>
                      <Label color={gatewayStatusColor} isCompact>
                        {gatewayDeployment.status}
                      </Label>
                    </FlexItem>
                  </Flex>
                  {gatewayDeployment.gatewayUrl && (
                    <Content component={ContentVariants.small} style={{ marginTop: "0.5rem" }}>
                      Gateway URL (in-cluster): <code>{gatewayDeployment.gatewayUrl}</code> — use this for the Agent
                      Sandbox Service&apos;s non-interactive <code>openshell gateway add --url</code> bootstrap.
                    </Content>
                  )}
                  {gatewayDeployment.error && (
                    <Alert variant="danger" isInline title={gatewayDeployment.error} style={{ marginTop: "0.5rem" }} />
                  )}
                  {gatewayDeployment.aapJobUrl && (
                    <Content component={ContentVariants.small} style={{ marginTop: "0.5rem" }}>
                      <a href={gatewayDeployment.aapJobUrl} target="_blank" rel="noreferrer">
                        View AAP job
                      </a>
                    </Content>
                  )}
                </CardBody>
              </Card>
            )}

            <Form style={{ marginTop: "1rem" }}>
              <Flex spaceItems={{ default: "spaceItemsMd" }}>
                <FlexItem flex={{ default: "flex_1" }}>
                  <FormGroup label="Helm chart reference" fieldId="gateway-chart-ref">
                    <TextInput
                      id="gateway-chart-ref"
                      value={gatewayChartRef}
                      onChange={(_e, v) => setGatewayChartRef(v)}
                    />
                  </FormGroup>
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }}>
                  <FormGroup label="Chart version (optional)" fieldId="gateway-chart-version">
                    <TextInput
                      id="gateway-chart-version"
                      placeholder="latest"
                      value={gatewayChartVersion}
                      onChange={(_e, v) => setGatewayChartVersion(v)}
                    />
                  </FormGroup>
                </FlexItem>
              </Flex>
              <Flex spaceItems={{ default: "spaceItemsMd" }}>
                <FlexItem flex={{ default: "flex_1" }}>
                  <FormGroup label="Namespace" fieldId="gateway-namespace">
                    <TextInput id="gateway-namespace" value={gatewayNamespace} onChange={(_e, v) => setGatewayNamespace(v)} />
                  </FormGroup>
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }}>
                  <FormGroup label="Workload kind" fieldId="gateway-workload-kind">
                    <FormSelect
                      id="gateway-workload-kind"
                      value={gatewayWorkloadKind}
                      onChange={(_e, v) => setGatewayWorkloadKind(v as GatewayWorkloadKind)}
                    >
                      <FormSelectOption value="statefulset" label="StatefulSet (SQLite, default)" />
                      <FormSelectOption value="deployment" label="Deployment (external Postgres, HA)" />
                    </FormSelect>
                  </FormGroup>
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }}>
                  <FormGroup label="AAP job template id" fieldId="gateway-job-template">
                    <TextInput
                      id="gateway-job-template"
                      placeholder="e.g. 43"
                      value={gatewayJobTemplateId}
                      onChange={(_e, v) => setGatewayJobTemplateId(v)}
                    />
                  </FormGroup>
                </FlexItem>
              </Flex>
            </Form>
            {platform.aap.jobTemplates.length > 0 && (
              <Content component={ContentVariants.small}>
                Templates: {platform.aap.jobTemplates.slice(0, 8).map((t) => `${t.name} (#${t.id})`).join(" · ")}
              </Content>
            )}
            {gatewayError && <Alert variant="danger" isInline title={gatewayError} style={{ marginTop: "0.5rem" }} />}
            <Flex spaceItems={{ default: "spaceItemsSm" }} style={{ marginTop: "0.75rem" }}>
              <FlexItem>
                <Button
                  variant="secondary"
                  isDisabled={savingGateway || deployingGateway}
                  onClick={() => void saveGatewaySettings()}
                >
                  {savingGateway ? "Saving…" : "Save settings"}
                </Button>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="primary"
                  isDisabled={deployingGateway || gatewayDeployment?.status === "deploying"}
                  onClick={() => void deployGatewayNow()}
                >
                  {deployingGateway || gatewayDeployment?.status === "deploying"
                    ? "Installing…"
                    : gatewayDeployment
                      ? "Re-install gateway"
                      : "Install gateway"}
                </Button>
              </FlexItem>
            </Flex>
          </CardBody>
        </Card>
      </FlexItem>

      <FlexItem>
        <Card>
          <CardTitle>Agent Sandbox Service</CardTitle>
          <CardBody>
            <Content component={ContentVariants.small}>
              Engineering listings with an OpenShell agent run interactively in a
              real sandbox provisioned by the in-cluster Agent Sandbox Service —
              the console never runs the openshell CLI or a terminal bridge
              itself, it only calls this service&apos;s REST + WebSocket API.
            </Content>
            <Flex
              justifyContent={{ default: "justifyContentSpaceBetween" }}
              alignItems={{ default: "alignItemsCenter" }}
              style={{ marginTop: "0.75rem" }}
            >
              <FlexItem>
                <strong>Agent Sandbox Service</strong>
                <Content component={ContentVariants.small}>
                  {platform.openshellService.configured ? platform.settings.openshellServiceUrl : "Not configured"}
                </Content>
              </FlexItem>
              <FlexItem>
                <Label color={platform.openshellService.connected ? "green" : "grey"} isCompact>
                  {platform.openshellService.connected ? "Connected" : platform.openshellService.error ?? "Disconnected"}
                </Label>
              </FlexItem>
            </Flex>
            <InputGroup style={{ marginTop: "0.75rem" }}>
              <InputGroupItem isFill>
                <TextInput
                  aria-label="Agent Sandbox Service URL"
                  value={serviceUrlDraft}
                  placeholder="https://agent-sandbox-service-agent-workloads.apps.example.com"
                  onChange={(_e, v) => setServiceUrlDraft(v)}
                />
              </InputGroupItem>
              <InputGroupItem>
                <Button variant="primary" isDisabled={saving} onClick={() => void saveServiceUrl()}>
                  {saving ? "Saving…" : "Save & test"}
                </Button>
              </InputGroupItem>
            </InputGroup>
            <Content component={ContentVariants.small}>
              Service configured: <strong>{settings.openshellServiceConfigured ? "Yes" : "No"}</strong> (needs both this
              URL and the token below)
            </Content>
            {serviceToken && <SecretField secret={serviceToken} onChange={loadSecrets} />}
            {gitPat && <SecretField secret={gitPat} onChange={loadSecrets} />}
          </CardBody>
        </Card>
      </FlexItem>

      <FlexItem>
        <Card>
          <CardTitle>Listings wired to OpenShell</CardTitle>
          <CardBody>
            {wired.length === 0 ? (
              <Content component={ContentVariants.small}>No listing has an OpenShell agent configured yet.</Content>
            ) : (
              <Table aria-label="Listings wired to OpenShell" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Listing</Th>
                    <Th>Department</Th>
                    <Th>OpenShell agent</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {wired.map((listing) => (
                    <Tr key={listing.id}>
                      <Td dataLabel="Listing">
                        <strong>{listing.name}</strong>
                      </Td>
                      <Td dataLabel="Department">{departmentLabel(listing.department)}</Td>
                      <Td dataLabel="OpenShell agent">{listing.openshellAgent}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </FlexItem>
    </Flex>
  );
}
