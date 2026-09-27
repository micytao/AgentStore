"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { NetworkIcon, PlugIcon, TerminalIcon } from "@patternfly/react-icons";
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
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  InputGroup,
  InputGroupItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Tab,
  Tabs,
  TabTitleIcon,
  TabTitleText,
  TextInput,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import {
  departmentLabel,
  PROVIDER_KINDS,
  type GatewayWorkloadKind,
  type Listing,
  type McpServerStatus,
  type McpTransport,
  type ProviderConfig,
  type ProviderKind,
  type ProviderStatus,
  type SecretSummary,
} from "@agentstore/shared";
import { SecretField } from "@/components/SecretField";
import {
  activateProviderConfig,
  connectMcpServerConfig,
  deleteMcpServerConfig,
  deleteProviderConfig,
  deployGateway,
  disconnectMcpServerConfig,
  fetchEngineSettings,
  fetchGatewayStatus,
  fetchListings,
  fetchMcpServers,
  fetchPlatformStatus,
  fetchProviders,
  fetchSecrets,
  setMcpAuthTokenValue,
  setMcpToolEnabledValue,
  setProviderKeyValue,
  testProviderConnection,
  updatePlatformSettings,
  upsertMcpServerConfig,
  upsertProviderConfig,
  type EngineSettings,
  type PlatformStatus,
} from "@/lib/api";

type LLMsSubTab = "providers" | "mcp" | "openshell";

const LLMS_SUBTABS: { id: LLMsSubTab; label: string; icon: ComponentType }[] = [
  { id: "providers", label: "Providers", icon: PlugIcon },
  { id: "mcp", label: "MCP", icon: NetworkIcon },
  { id: "openshell", label: "OpenShell", icon: TerminalIcon },
];

export function LLMsPanel() {
  const [subTab, setSubTab] = useState<LLMsSubTab>("providers");

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }}>
      <FlexItem>
        <Tabs
          activeKey={subTab}
          onSelect={(_event, eventKey) => setSubTab(eventKey as LLMsSubTab)}
          aria-label="LLM sections"
          isSubtab
        >
          {LLMS_SUBTABS.map((item) => {
            const Icon = item.icon;
            return (
              <Tab
                key={item.id}
                eventKey={item.id}
                title={
                  <>
                    <TabTitleIcon>
                      <Icon />
                    </TabTitleIcon>
                    <TabTitleText>{item.label}</TabTitleText>
                  </>
                }
              />
            );
          })}
        </Tabs>
      </FlexItem>

      <FlexItem>
        {subTab === "providers" && <ProvidersPanel />}
        {subTab === "mcp" && <McpPanel />}
        {subTab === "openshell" && <OpenShellPanel />}
      </FlexItem>
    </Flex>
  );
}

function OpenShellPanel() {
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

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || `provider-${Date.now()}`
  );
}

function ProvidersPanel() {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function load() {
    fetchProviders()
      .then(setProviders)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  if (error) return <Alert variant="danger" isInline title={error} />;
  if (!providers) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading providers" />
      </Bullseye>
    );
  }

  return (
    <Card>
      <CardTitle>Model providers</CardTitle>
      <CardBody>
        <Content component={ContentVariants.small}>
          Add a real API key for a provider, test the connection, and mark
          one provider active. The active provider powers generic-chat
          agent conversations and OpenShell model selection whenever a
          listing doesn't bind its own provider.
        </Content>

        {providers.length === 0 && (
          <Content component={ContentVariants.small}>No providers configured yet.</Content>
        )}

        <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "1rem" }}>
          {providers.map((provider) => (
            <FlexItem key={provider.id}>
              <ProviderRow provider={provider} onChange={load} />
            </FlexItem>
          ))}
        </Flex>

        <Button variant="secondary" style={{ marginTop: "1rem" }} onClick={() => setShowAdd(true)}>
          + Add provider
        </Button>

        {showAdd && (
          <AddProviderForm
            onDone={() => {
              setShowAdd(false);
              load();
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}
      </CardBody>
    </Card>
  );
}

function AddProviderForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<ProviderKind>("anthropic");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function applyMaasPreset() {
    setKind("openai-compatible");
    setLabel((prev) => prev || "OpenShift AI (MaaS)");
    setBaseUrl((prev) => prev || "http://localhost:8000/v1");
  }

  async function save() {
    if (!label.trim()) {
      setErr("Label is required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const config: ProviderConfig = {
        id: `${slugify(label)}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        label: label.trim(),
        baseUrl: kind === "openai-compatible" ? baseUrl.trim() || undefined : undefined,
      };
      await upsertProviderConfig(config);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal variant="medium" isOpen onClose={onCancel} aria-label="Add provider">
      <ModalHeader title="Add provider" />
      <ModalBody>
        <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
          {err && (
            <FlexItem>
              <Alert variant="danger" isInline title={err} />
            </FlexItem>
          )}
          <FlexItem>
            <Content component={ContentVariants.small}>
              Quick preset:{" "}
              <Button variant="link" isInline onClick={applyMaasPreset}>
                OpenShift AI — Model as a Service
              </Button>{" "}
              — points an OpenAI-compatible provider at a vLLM endpoint served by
              Red Hat OpenShift AI&apos;s Model as a Service (KServe/vLLM); no API key
              required for a locally self-hosted one.
            </Content>
          </FlexItem>
          <FlexItem>
            <Form>
              <FormGroup label="Kind" fieldId="add-provider-kind">
                <FormSelect id="add-provider-kind" value={kind} onChange={(_e, v) => setKind(v as ProviderKind)}>
                  {PROVIDER_KINDS.map((k) => (
                    <FormSelectOption key={k.id} value={k.id} label={k.label} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Label" isRequired fieldId="add-provider-label">
                <TextInput
                  id="add-provider-label"
                  placeholder="Label, e.g. Anthropic (prod)"
                  value={label}
                  onChange={(_e, v) => setLabel(v)}
                />
              </FormGroup>
              {kind === "openai-compatible" && (
                <FormGroup label="Base URL" fieldId="add-provider-base-url">
                  <TextInput
                    id="add-provider-base-url"
                    placeholder="Base URL, e.g. http://localhost:8000/v1"
                    value={baseUrl}
                    onChange={(_e, v) => setBaseUrl(v)}
                  />
                </FormGroup>
              )}
            </Form>
          </FlexItem>
          {kind === "openai-compatible" && (
            <FlexItem>
              <Content component={ContentVariants.small}>
                No API key needed for a self-hosted server with no auth configured
                — leave the key blank after adding and just hit &quot;Test
                connection&quot;.
              </Content>
            </FlexItem>
          )}
        </Flex>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={() => void save()} isDisabled={saving}>
          {saving ? "Adding…" : "Add provider"}
        </Button>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function ProviderRow({
  provider,
  onChange,
}: {
  provider: ProviderStatus;
  onChange: () => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [model, setModel] = useState(provider.defaultModel ?? "");
  const [busy, setBusy] = useState(false);

  async function saveKey() {
    if (!keyInput.trim()) return;
    setSavingKey(true);
    try {
      await setProviderKeyValue(provider.id, keyInput.trim());
      setKeyInput("");
      onChange();
    } finally {
      setSavingKey(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      await testProviderConnection(provider.id);
      onChange();
    } finally {
      setTesting(false);
    }
  }

  async function saveModel(next: string) {
    setModel(next);
    await upsertProviderConfig({ ...provider, defaultModel: next });
    onChange();
  }

  async function activate() {
    setBusy(true);
    try {
      await activateProviderConfig(provider.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteProviderConfig(provider.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card isCompact>
      <CardBody>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsFlexStart" }}>
          <FlexItem>
            <strong>{provider.label}</strong>
            <Content component={ContentVariants.small}>
              {PROVIDER_KINDS.find((k) => k.id === provider.kind)?.label ?? provider.kind}
            </Content>
          </FlexItem>
          <FlexItem>
            <Flex spaceItems={{ default: "spaceItemsSm" }}>
              <FlexItem>
                <Label color={provider.active ? "green" : "grey"} isCompact>
                  {provider.active ? "Active" : "Inactive"}
                </Label>
              </FlexItem>
              <FlexItem>
                <Label
                  color={provider.hasKey ? "green" : provider.kind === "openai-compatible" ? "grey" : "orange"}
                  isCompact
                >
                  {provider.hasKey
                    ? `Key set (${provider.keyPreview})`
                    : provider.kind === "openai-compatible"
                      ? "No key (optional for self-hosted servers)"
                      : "No key"}
                </Label>
              </FlexItem>
              {provider.lastError && (
                <FlexItem>
                  <Label color="red" isCompact>
                    Test failed
                  </Label>
                </FlexItem>
              )}
              {provider.lastChecked && !provider.lastError && (
                <FlexItem>
                  <Label color="blue" isCompact>
                    Tested OK
                  </Label>
                </FlexItem>
              )}
            </Flex>
          </FlexItem>
        </Flex>

        <InputGroup style={{ marginTop: "0.75rem" }}>
          <InputGroupItem isFill>
            <TextInput
              type="password"
              aria-label={`API key for ${provider.label}`}
              placeholder="Paste API key"
              value={keyInput}
              onChange={(_e, v) => setKeyInput(v)}
            />
          </InputGroupItem>
          <InputGroupItem>
            <Button variant="secondary" onClick={saveKey} isDisabled={savingKey || !keyInput.trim()}>
              {savingKey ? "Saving…" : "Save key"}
            </Button>
          </InputGroupItem>
          <InputGroupItem>
            <Button
              variant="secondary"
              onClick={test}
              isDisabled={testing || (!provider.hasKey && provider.kind !== "openai-compatible")}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
          </InputGroupItem>
        </InputGroup>

        {provider.lastError && <Alert variant="danger" isInline title={provider.lastError} style={{ marginTop: "0.5rem" }} />}

        {provider.models && provider.models.length > 0 && (
          <FormSelect
            aria-label={`Default model for ${provider.label}`}
            value={model}
            onChange={(_e, v) => saveModel(v)}
            style={{ marginTop: "0.75rem" }}
          >
            <FormSelectOption value="" label="Default model…" />
            {provider.models.map((m) => (
              <FormSelectOption key={m} value={m} label={m} />
            ))}
          </FormSelect>
        )}

        <Flex spaceItems={{ default: "spaceItemsSm" }} style={{ marginTop: "0.75rem" }}>
          {!provider.active && (
            <FlexItem>
              <Button variant="secondary" onClick={activate} isDisabled={busy}>
                Make active
              </Button>
            </FlexItem>
          )}
          <FlexItem>
            <Button variant="danger" onClick={remove} isDisabled={busy}>
              Remove
            </Button>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
}

const MCP_TRANSPORTS: { id: McpTransport; label: string }[] = [
  { id: "stdio", label: "stdio (local command)" },
  { id: "streamable-http", label: "Streamable HTTP" },
  { id: "sse", label: "SSE (legacy)" },
];

function McpPanel() {
  const [servers, setServers] = useState<McpServerStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function load() {
    fetchMcpServers()
      .then(setServers)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  if (error) return <Alert variant="danger" isInline title={error} />;
  if (!servers) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading MCP servers" />
      </Bullseye>
    );
  }

  return (
    <Card>
      <CardTitle>MCP servers &amp; tools</CardTitle>
      <CardBody>
        <Content component={ContentVariants.small}>
          Connect a real MCP server, then enable individual tools you want
          your agents to be able to call.{" "}
          <strong>stdio servers run a local command you specify — only
          connect servers you trust.</strong>
        </Content>

        {servers.length === 0 && (
          <Content component={ContentVariants.small}>No MCP servers registered yet.</Content>
        )}

        <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "1rem" }}>
          {servers.map((server) => (
            <FlexItem key={server.id}>
              <McpServerRow server={server} onChange={load} />
            </FlexItem>
          ))}
        </Flex>

        <Button variant="secondary" style={{ marginTop: "1rem" }} onClick={() => setShowAdd(true)}>
          + Add MCP server
        </Button>

        {showAdd && (
          <AddMcpServerForm
            onDone={() => {
              setShowAdd(false);
              load();
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}
      </CardBody>
    </Card>
  );
}

function AddMcpServerForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setErr("Name is required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await upsertMcpServerConfig({
        id: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        transport,
        command: transport === "stdio" ? command.trim() || undefined : undefined,
        args: transport === "stdio" ? args.split(" ").filter(Boolean) : undefined,
        url: transport !== "stdio" ? url.trim() || undefined : undefined,
        enabled: true,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal variant="medium" isOpen onClose={onCancel} aria-label="Add MCP server">
      <ModalHeader title="Add MCP server" />
      <ModalBody>
        <Form>
          {err && <Alert variant="danger" isInline title={err} />}
          <FormGroup label="Transport" fieldId="add-mcp-transport">
            <FormSelect id="add-mcp-transport" value={transport} onChange={(_e, v) => setTransport(v as McpTransport)}>
              {MCP_TRANSPORTS.map((t) => (
                <FormSelectOption key={t.id} value={t.id} label={t.label} />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label="Name" isRequired fieldId="add-mcp-name">
            <TextInput id="add-mcp-name" placeholder="Name" value={name} onChange={(_e, v) => setName(v)} />
          </FormGroup>
          {transport === "stdio" ? (
            <>
              <FormGroup label="Command" fieldId="add-mcp-command">
                <TextInput
                  id="add-mcp-command"
                  placeholder="Command, e.g. npx"
                  value={command}
                  onChange={(_e, v) => setCommand(v)}
                />
              </FormGroup>
              <FormGroup label="Args" fieldId="add-mcp-args">
                <TextInput
                  id="add-mcp-args"
                  placeholder="Args, space separated"
                  value={args}
                  onChange={(_e, v) => setArgs(v)}
                />
              </FormGroup>
            </>
          ) : (
            <FormGroup label="Server URL" fieldId="add-mcp-url">
              <TextInput
                id="add-mcp-url"
                placeholder="Server URL, e.g. https://host/mcp"
                value={url}
                onChange={(_e, v) => setUrl(v)}
              />
            </FormGroup>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={() => void save()} isDisabled={saving}>
          {saving ? "Adding…" : "Add server"}
        </Button>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function McpServerRow({
  server,
  onChange,
}: {
  server: McpServerStatus;
  onChange: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    setConnecting(true);
    try {
      await connectMcpServerConfig(server.id);
      onChange();
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectMcpServerConfig(server.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function saveToken() {
    if (!tokenInput.trim()) return;
    setBusy(true);
    try {
      await setMcpAuthTokenValue(server.id, tokenInput.trim());
      setTokenInput("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteMcpServerConfig(server.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function toggleTool(toolName: string, enabled: boolean) {
    await setMcpToolEnabledValue(server.id, toolName, enabled);
    onChange();
  }

  const stateColor: "green" | "red" | "grey" =
    server.connectionState === "connected" ? "green" : server.connectionState === "error" ? "red" : "grey";

  return (
    <Card isCompact>
      <CardBody>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsFlexStart" }}>
          <FlexItem>
            <strong>{server.name}</strong>
            <Content component={ContentVariants.small}>
              {MCP_TRANSPORTS.find((t) => t.id === server.transport)?.label ?? server.transport} ·{" "}
              {server.transport === "stdio" ? server.command : server.url}
            </Content>
          </FlexItem>
          <FlexItem>
            <Label color={stateColor} isCompact>
              {server.connectionState}
            </Label>
          </FlexItem>
        </Flex>

        {server.lastError && <Alert variant="danger" isInline title={server.lastError} style={{ marginTop: "0.5rem" }} />}

        {server.transport !== "stdio" && (
          <InputGroup style={{ marginTop: "0.75rem" }}>
            <InputGroupItem isFill>
              <TextInput
                type="password"
                aria-label={`Auth token for ${server.name}`}
                placeholder={server.hasAuthToken ? "Auth token set — enter to replace" : "Bearer auth token (optional)"}
                value={tokenInput}
                onChange={(_e, v) => setTokenInput(v)}
              />
            </InputGroupItem>
            <InputGroupItem>
              <Button variant="secondary" onClick={saveToken} isDisabled={busy || !tokenInput.trim()}>
                Save token
              </Button>
            </InputGroupItem>
          </InputGroup>
        )}

        <Flex spaceItems={{ default: "spaceItemsSm" }} style={{ marginTop: "0.75rem" }}>
          <FlexItem>
            <Button variant="secondary" onClick={connect} isDisabled={connecting}>
              {connecting ? "Connecting…" : server.connectionState === "connected" ? "Reconnect" : "Connect"}
            </Button>
          </FlexItem>
          {server.connectionState === "connected" && (
            <FlexItem>
              <Button variant="secondary" onClick={disconnect} isDisabled={busy}>
                Disconnect
              </Button>
            </FlexItem>
          )}
          <FlexItem>
            <Button variant="danger" onClick={remove} isDisabled={busy}>
              Remove
            </Button>
          </FlexItem>
        </Flex>

        {server.connectionState === "connected" && (
          <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsXs" }} style={{ marginTop: "0.75rem" }}>
            {server.tools.length === 0 ? (
              <FlexItem>
                <Content component={ContentVariants.small}>This server did not advertise any tools.</Content>
              </FlexItem>
            ) : (
              server.tools.map((tool) => (
                <FlexItem key={tool.name}>
                  <Checkbox
                    id={`mcp-tool-${server.id}-${tool.name}`}
                    isChecked={tool.enabled}
                    onChange={(_e, checked) => toggleTool(tool.name, checked)}
                    label={
                      <>
                        {tool.name}
                        {tool.description && (
                          <Content component={ContentVariants.small}>{tool.description}</Content>
                        )}
                      </>
                    }
                  />
                </FlexItem>
              ))
            )}
          </Flex>
        )}
      </CardBody>
    </Card>
  );
}
