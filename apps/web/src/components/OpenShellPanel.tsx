"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Progress,
  Spinner,
  Tab,
  Tabs,
  TabTitleText,
  TextInput,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import {
  departmentLabel,
  openshellImageForAgent,
  type AgentSandboxControllerStatus,
  type AgentSandboxServiceInstallStatus,
  type GatewayWorkloadKind,
  type Listing,
  type SecretSummary,
} from "@agentstore/shared";
import { SecretField } from "@/components/SecretField";
import {
  deleteOpenShellSession,
  deployGateway,
  fetchAgentSandboxServiceInstallStatus,
  fetchAgentSandboxStatus,
  fetchEngineSettings,
  fetchGatewayStatus,
  fetchListings,
  fetchOpenShellSessions,
  fetchPlatformStatus,
  fetchSecrets,
  fetchSessionTerminalEndpoint,
  installAgentSandboxController,
  startAgentSandboxServiceInstall,
  updatePlatformSettings,
  type EngineSettings,
  type OpenShellSession,
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
  const [activeTabKey, setActiveTabKey] = useState<string | number>("gateway");

  // Onboard gateway card — admin-supplied Helm chart ref + install params,
  // defaulting to NVIDIA's real published chart. Drafts mirror the
  // corresponding PlatformSettings fields; saved via the same PATCH
  // updatePlatformSettings() other Platform-tab fields use.
  const [gatewayChartRef, setGatewayChartRef] = useState("");
  const [gatewayChartVersion, setGatewayChartVersion] = useState("");
  const [gatewayNamespace, setGatewayNamespace] = useState("");
  const [gatewayWorkloadKind, setGatewayWorkloadKind] = useState<GatewayWorkloadKind>("statefulset");
  const [savingGateway, setSavingGateway] = useState(false);
  const [deployingGateway, setDeployingGateway] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  // Agent Sandbox controller preflight — live "installed/missing" check
  // (platform.openshift.agentSandboxController, refreshed on every
  // fetchPlatformStatus()) plus the "Install Agent Sandbox controller"
  // button's own transient state. Unlike the gateway install above,
  // there's no persisted PlatformSettings field for this — it's derived
  // live, so installing/polling state only needs to live here.
  const [installingAgentSandbox, setInstallingAgentSandbox] = useState(false);
  const [agentSandboxPolling, setAgentSandboxPolling] = useState(false);
  const [agentSandboxError, setAgentSandboxError] = useState<string | null>(null);

  // Agent Sandbox Service install — apps/agent-sandbox-service has no
  // public image, so unlike the controller preflight above, this is a
  // genuine two-phase build-then-deploy flow persisted onto
  // PlatformSettings.agentSandboxServiceInstall (platform.settings, not
  // platform.openshift — it's this repo's own app, not a cluster-level
  // capability check).
  const [startingAgentSandboxServiceInstall, setStartingAgentSandboxServiceInstall] = useState(false);
  const [agentSandboxServiceInstallError, setAgentSandboxServiceInstallError] = useState<string | null>(null);

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

  function applyAgentSandboxStatus(status: AgentSandboxControllerStatus) {
    setPlatform((prev) =>
      prev ? { ...prev, openshift: { ...prev.openshift, agentSandboxController: status } } : prev
    );
  }

  // Poll the live preflight check for a few seconds after a successful
  // install call, in case the CRD hasn't finished becoming "Established"
  // (and so isn't served under /apis yet) the instant the apply
  // request returns — same interval-polling shape as the gateway poll
  // above, just against the cheap synchronous status check instead of
  // an in-flight deploy.
  useEffect(() => {
    if (!agentSandboxPolling) return;
    const timer = setInterval(() => {
      fetchAgentSandboxStatus()
        .then((status) => {
          applyAgentSandboxStatus(status);
          if (status.installed) setAgentSandboxPolling(false);
        })
        .catch((err: Error) => setAgentSandboxError(err.message));
    }, 3000);
    return () => clearInterval(timer);
  }, [agentSandboxPolling]);

  async function installAgentSandboxNow() {
    setInstallingAgentSandbox(true);
    setAgentSandboxError(null);
    try {
      const result = await installAgentSandboxController();
      applyAgentSandboxStatus(result.status);
      setAgentSandboxPolling(!result.status.installed);
    } catch (err) {
      setAgentSandboxError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingAgentSandbox(false);
    }
  }

  const agentSandboxServiceInstall = platform?.settings.agentSandboxServiceInstall;

  // Poll the in-flight build/deploy for progress — same interval-polling
  // shape as the gateway poll above. Once it leaves "deploying" (either
  // "running" or "failed"), do a full load() rather than just patching
  // `platform.settings`: a successful install also changes the
  // OPENSHELL_SERVICE_TOKEN secret and openshellServiceUrl, both of
  // which need fresh fetchSecrets()/fetchPlatformStatus() calls to show
  // up correctly (the connectivity Label, the URL field, the SecretField).
  useEffect(() => {
    if (agentSandboxServiceInstall?.status !== "deploying") return;
    const timer = setInterval(() => {
      fetchAgentSandboxServiceInstallStatus()
        .then((nextSettings) => {
          if (nextSettings.agentSandboxServiceInstall?.status === "deploying") {
            setPlatform((prev) => (prev ? { ...prev, settings: nextSettings } : prev));
          } else {
            load();
          }
        })
        .catch((err: Error) => setAgentSandboxServiceInstallError(err.message));
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentSandboxServiceInstall?.status]);

  async function installAgentSandboxServiceNow() {
    setStartingAgentSandboxServiceInstall(true);
    setAgentSandboxServiceInstallError(null);
    try {
      const nextSettings = await startAgentSandboxServiceInstall();
      setPlatform((prev) => (prev ? { ...prev, settings: nextSettings } : prev));
    } catch (err) {
      setAgentSandboxServiceInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingAgentSandboxServiceInstall(false);
    }
  }

  /** Coarse progress estimate for the install button's Progress bar —
   * OpenShift doesn't expose a real build percentage (same limitation
   * PlatformPanel.tsx's ocpBuildProgressPercent() works around), plus
   * this has a second "waiting for rollout" phase that plain OpenShift
   * Build phases don't cover. */
  function agentSandboxServiceInstallPercent(
    install: AgentSandboxServiceInstallStatus | undefined,
    running: boolean,
    done: boolean
  ): number {
    if (done) return 100;
    if (!running) return 0;
    if (install?.phase === "waiting-for-rollout") return 90;
    switch (install?.ocpPhase) {
      case "Pending":
        return 15;
      case "Running":
        return 55;
      case "Complete":
        return 80;
      default:
        return 5;
    }
  }

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

  const openshellServiceConnected = platform.openshellService.connected;
  const wired = listings.filter((listing) => listing.openshellAgent);
  const serviceToken = secrets.find((s) => s.key === "OPENSHELL_SERVICE_TOKEN");
  const gitPat = secrets.find((s) => s.key === "GIT_PAT");
  const githubPackagesToken = secrets.find((s) => s.key === "GITHUB_PACKAGES_TOKEN");
  const gatewayStatusColor: "green" | "red" | "grey" =
    gatewayDeployment?.status === "running" ? "green" : gatewayDeployment?.status === "failed" ? "red" : "grey";
  const agentSandboxController = platform.openshift.agentSandboxController;

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }}>
      <FlexItem>
        <Tabs
          activeKey={activeTabKey}
          onSelect={(_e, key) => setActiveTabKey(key)}
          aria-label="OpenShell sections"
          isBox
        >
          <Tab eventKey="gateway" title={<TabTitleText>OpenShell Gateway</TabTitleText>}>
            <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }} style={{ marginTop: "1rem" }}>
      <FlexItem>
        <Card>
          <CardTitle>Onboard the OpenShell gateway</CardTitle>
          <CardBody>
            <Content component={ContentVariants.small}>
              NVIDIA OpenShell is the real sandboxing runtime the Agent Sandbox
              Service below talks to. Installing it is a live{" "}
              <code>helm upgrade --install</code> against the chart reference
              below, run once via the OpenShift API — the console never runs Helm itself. See{" "}
              <a href="https://docs.nvidia.com/openshell/kubernetes/openshift" target="_blank" rel="noreferrer">
                docs.nvidia.com/openshell/kubernetes/openshift
              </a>
              .
            </Content>
            <Flex
              alignItems={{ default: "alignItemsCenter" }}
              spaceItems={{ default: "spaceItemsSm" }}
              style={{ marginTop: "0.75rem" }}
            >
              <FlexItem>
                <strong>Agent Sandbox controller</strong>
              </FlexItem>
              <FlexItem>
                <Label color={agentSandboxController.installed ? "green" : "red"} isCompact>
                  {agentSandboxController.installed ? "Installed" : "Missing"}
                </Label>
              </FlexItem>
            </Flex>
            <Content component={ContentVariants.small}>
              The cluster-scoped Agent Sandbox controller + CRDs are a separate,
              elevated-privilege prerequisite the gateway install below depends
              on — the OpenShell chart&apos;s own preflight refuses to install
              without it.
            </Content>
            {agentSandboxController.installed ? (
              <Content component={ContentVariants.small}>
                Detected on this cluster — the gateway install below should succeed.
              </Content>
            ) : (
              <>
                <Content component={ContentVariants.small}>
                  Not detected on this cluster yet. Click <strong>Install Agent Sandbox
                  controller</strong> below — it applies the pinned manifest at{" "}
                  <em>deploy/openshift/agent-sandbox-crds.yaml</em> using the OpenShift token
                  configured above, which needs cluster-admin-equivalent permissions. If it
                  fails, apply it manually instead — see <em>deploy/openshift/README.md</em>{" "}
                  for the exact command.
                </Content>
                {agentSandboxController.error && (
                  <Content component={ContentVariants.small} style={{ color: "var(--pf-t--global--text--color--subtle)" }}>
                    Preflight check couldn&apos;t confirm this either way: {agentSandboxController.error}
                  </Content>
                )}
                {agentSandboxError && (
                  <Alert variant="danger" isInline title={agentSandboxError} style={{ marginTop: "0.5rem" }} />
                )}
                <Button
                  variant="secondary"
                  isDisabled={installingAgentSandbox || agentSandboxPolling}
                  style={{ marginTop: "0.5rem" }}
                  onClick={() => void installAgentSandboxNow()}
                >
                  {installingAgentSandbox
                    ? "Installing…"
                    : agentSandboxPolling
                      ? "Waiting for controller…"
                      : "Install Agent Sandbox controller"}
                </Button>
              </>
            )}

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
              </Flex>
            </Form>
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
            </Flex>
          </Tab>

          <Tab eventKey="sessions" title={<TabTitleText>Sessions</TabTitleText>}>
            <SessionsConsole active={activeTabKey === "sessions"} serviceConnected={platform.openshellService.connected} />
          </Tab>

          <Tab eventKey="sandbox-service" title={<TabTitleText>Agent Sandbox Service</TabTitleText>}>
            <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }} style={{ marginTop: "1rem" }}>
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

            {!platform.openshellService.configured && (
              <Content component={ContentVariants.small} style={{ marginTop: "0.5rem" }}>
                Not deployed yet? <strong>Install Agent Sandbox Service</strong> below builds{" "}
                <code>apps/agent-sandbox-service/Containerfile</code> as an OpenShift BuildConfig
                (same Project Git URL/branch as the Connections card on the Platform tab),
                deploys it, and fills in the URL/token below automatically — no separate{" "}
                <code>podman build</code>/<code>oc apply</code> needed. Needs the same OpenShift
                token used elsewhere on this tab (namespace-scoped Deployment/Service/Route/Secret
                permissions — no extra RBAC beyond what the gateway install already needs).
              </Content>
            )}
            {agentSandboxServiceInstallError && (
              <Alert variant="danger" isInline title={agentSandboxServiceInstallError} style={{ marginTop: "0.5rem" }} />
            )}
            {agentSandboxServiceInstall?.error && (
              <Alert variant="danger" isInline title={agentSandboxServiceInstall.error} style={{ marginTop: "0.5rem" }} />
            )}
            {(() => {
              const running = agentSandboxServiceInstall?.status === "deploying";
              const done = agentSandboxServiceInstall?.status === "running";
              const failed = agentSandboxServiceInstall?.status === "failed";
              return (
                <>
                  <div style={{ marginTop: "0.5rem" }}>
                    <Button
                      variant="secondary"
                      isDisabled={startingAgentSandboxServiceInstall || running}
                      onClick={() => void installAgentSandboxServiceNow()}
                    >
                      {startingAgentSandboxServiceInstall
                        ? "Starting…"
                        : running
                          ? `Installing… (${agentSandboxServiceInstall?.phase === "waiting-for-rollout" ? "waiting for rollout" : agentSandboxServiceInstall?.ocpPhase ?? "starting"})`
                          : platform.openshellService.configured
                            ? "Reinstall Agent Sandbox Service"
                            : "Install Agent Sandbox Service"}
                    </Button>
                  </div>
                  {(running || done || failed) && (
                    <Progress
                      value={agentSandboxServiceInstallPercent(agentSandboxServiceInstall, running, done)}
                      title="Agent Sandbox Service install"
                      label={
                        failed
                          ? "Failed"
                          : agentSandboxServiceInstall?.phase === "waiting-for-rollout"
                            ? "Waiting for pod rollout…"
                            : agentSandboxServiceInstall?.ocpPhase ?? "Starting…"
                      }
                      variant={failed ? "danger" : done ? "success" : undefined}
                      measureLocation="inside"
                      style={{ marginTop: "0.5rem", maxWidth: "420px" }}
                    />
                  )}
                </>
              );
            })()}

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
            <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "0.75rem" }}>
              {serviceToken && <FlexItem><SecretField secret={serviceToken} onChange={loadSecrets} badge="Runtime" /></FlexItem>}
              {gitPat && <FlexItem><SecretField secret={gitPat} onChange={loadSecrets} badge="Runtime" /></FlexItem>}
              {githubPackagesToken && <FlexItem><SecretField secret={githubPackagesToken} onChange={loadSecrets} badge="Build time" /></FlexItem>}
            </Flex>
          </CardBody>
        </Card>
      </FlexItem>
            </Flex>
          </Tab>
        </Tabs>
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
                    <Th>Sandbox image</Th>
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
                      <Td dataLabel="Sandbox image">
                        <code style={{ fontSize: "0.85em" }}>
                          {listing.agentConfig?.openshellSandboxImage ??
                            openshellImageForAgent(listing.openshellAgent ?? "opencode")}
                        </code>
                      </Td>
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

// ---------------------------------------------------------------------------
// Sessions console — self-contained sub-tab component
// ---------------------------------------------------------------------------

function phaseColor(phase: string): "green" | "blue" | "red" | "grey" {
  switch (phase) {
    case "Running": return "green";
    case "Provisioning": return "blue";
    case "Failed": return "red";
    default: return "grey";
  }
}

function formatAge(createdAt: number): string {
  const seconds = Math.floor((Date.now() - createdAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function SessionsConsole({ active, serviceConnected }: { active: boolean; serviceConnected: boolean }) {
  const [sessions, setSessions] = useState<OpenShellSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [terminalSession, setTerminalSession] = useState<string | null>(null);
  const [terminalUrl, setTerminalUrl] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalConnecting, setTerminalConnecting] = useState(false);
  const termHostRef = useRef<HTMLDivElement>(null);
  const termCleanupRef = useRef<(() => void) | null>(null);

  const loadSessions = useCallback(() => {
    if (!serviceConnected) {
      setSessions([]);
      setLoading(false);
      return;
    }
    fetchOpenShellSessions()
      .then((data) => {
        setSessions(data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [serviceConnected]);

  // Poll every 5s while tab is active
  useEffect(() => {
    if (!active) return;
    loadSessions();
    const timer = setInterval(loadSessions, 5000);
    return () => clearInterval(timer);
  }, [active, loadSessions]);

  async function handleDelete(id: string) {
    setDeleting(id);
    setConfirmDelete(null);
    try {
      await deleteOpenShellSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(null);
    }
  }

  // Terminal lifecycle
  useEffect(() => {
    return () => {
      termCleanupRef.current?.();
    };
  }, []);

  async function openTerminal(id: string) {
    // Close any existing terminal
    termCleanupRef.current?.();
    termCleanupRef.current = null;
    setTerminalSession(id);
    setTerminalUrl(null);
    setTerminalError(null);
    setTerminalConnecting(true);

    try {
      const endpoint = await fetchSessionTerminalEndpoint(id);
      if (!endpoint.url) {
        setTerminalError("No terminal URL returned.");
        setTerminalConnecting(false);
        return;
      }
      setTerminalUrl(endpoint.url);
    } catch (err) {
      setTerminalError(err instanceof Error ? err.message : String(err));
      setTerminalConnecting(false);
    }
  }

  // Boot xterm when terminalUrl is set
  useEffect(() => {
    if (!terminalUrl || !termHostRef.current) return;
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | undefined;
    let socket: WebSocket | undefined;
    let resizeObserver: ResizeObserver | undefined;

    async function boot() {
      const [{ Terminal }, { FitAddon }, { AttachAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-attach"),
      ]);
      if (disposed || !termHostRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 14,
        theme: {
          background: "#0b0d16",
          foreground: "#e8eaf4",
          cursor: "#7cf0d4",
          cursorAccent: "#0b0d16",
        },
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(termHostRef.current);
      fitAddon.fit();

      socket = new WebSocket(terminalUrl!);
      socket.addEventListener("open", () => {
        if (!disposed) setTerminalConnecting(false);
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          socket!.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
        term?.focus();
      });
      socket.addEventListener("close", () => {
        if (!disposed) term?.writeln("\r\n\x1b[2m(session ended)\x1b[0m");
      });
      socket.addEventListener("error", () => {
        if (!disposed) setTerminalError("Terminal connection lost.");
      });

      term.loadAddon(new AttachAddon(socket));
      term.onResize(({ cols, rows }) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      resizeObserver = new ResizeObserver(() => fitAddon.fit());
      resizeObserver.observe(termHostRef.current);
    }

    void boot().catch((err: Error) => {
      if (!disposed) {
        setTerminalError(err.message);
        setTerminalConnecting(false);
      }
    });

    termCleanupRef.current = () => {
      disposed = true;
      resizeObserver?.disconnect();
      socket?.close();
      term?.dispose();
    };

    return () => {
      termCleanupRef.current?.();
      termCleanupRef.current = null;
    };
  }, [terminalUrl]);

  function closeTerminal() {
    termCleanupRef.current?.();
    termCleanupRef.current = null;
    setTerminalSession(null);
    setTerminalUrl(null);
    setTerminalError(null);
    setTerminalConnecting(false);
  }

  if (!serviceConnected) {
    return (
      <div style={{ marginTop: "1rem" }}>
        <Alert variant="info" isInline title="Agent Sandbox Service not connected">
          Configure and connect the Agent Sandbox Service on the &ldquo;Agent Sandbox Service&rdquo; tab to manage sessions.
        </Alert>
      </div>
    );
  }

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "1rem" }}>
      <FlexItem>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
          <FlexItem>
            <strong>Sandbox Sessions</strong>
            <Content component={ContentVariants.small}>
              Live sessions on the OpenShell gateway — includes sessions from AgentStore listings and any created externally.
            </Content>
          </FlexItem>
          <FlexItem>
            <Button variant="plain" aria-label="Refresh sessions" onClick={loadSessions} isDisabled={loading}>
              {loading ? <Spinner size="sm" /> : "⟳ Refresh"}
            </Button>
          </FlexItem>
        </Flex>
      </FlexItem>

      {error && (
        <FlexItem>
          <Alert variant="danger" isInline title={error} />
        </FlexItem>
      )}

      <FlexItem>
        {sessions.length === 0 && !loading ? (
          <Card>
            <CardBody>
              <Bullseye>
                <Content component={ContentVariants.p}>
                  No active sessions. Deploy an agent from the <strong>Catalog</strong> to create one.
                </Content>
              </Bullseye>
            </CardBody>
          </Card>
        ) : (
          <Table aria-label="Sandbox sessions" variant="compact">
            <Thead>
              <Tr>
                <Th>Session ID</Th>
                <Th>Agent</Th>
                <Th>Phase</Th>
                <Th>Age</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {sessions.map((s) => (
                <Tr key={s.id}>
                  <Td dataLabel="Session ID">
                    <code style={{ fontSize: "0.85em" }}>{s.id}</code>
                  </Td>
                  <Td dataLabel="Agent">{s.agent}</Td>
                  <Td dataLabel="Phase">
                    <Label color={phaseColor(s.phase)} isCompact>
                      {s.phase}
                    </Label>
                    {s.message && (
                      <Content component={ContentVariants.small} style={{ marginTop: "0.25rem", maxWidth: "300px", wordBreak: "break-word" }}>
                        {s.message}
                      </Content>
                    )}
                  </Td>
                  <Td dataLabel="Age">{formatAge(s.createdAt)}</Td>
                  <Td dataLabel="Actions">
                    <Flex spaceItems={{ default: "spaceItemsSm" }}>
                      <FlexItem>
                        <Button
                          variant="secondary"
                          size="sm"
                          isDisabled={s.phase !== "Running"}
                          onClick={() => void openTerminal(s.id)}
                        >
                          Open terminal
                        </Button>
                      </FlexItem>
                      <FlexItem>
                        <Button
                          variant="danger"
                          size="sm"
                          isDisabled={deleting === s.id}
                          onClick={() => setConfirmDelete(s.id)}
                        >
                          {deleting === s.id ? "Deleting…" : "Delete"}
                        </Button>
                      </FlexItem>
                    </Flex>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </FlexItem>

      {/* Inline terminal drawer */}
      {terminalSession && (
        <FlexItem>
          <Card>
            <CardBody>
              <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
                <FlexItem>
                  <strong>Terminal:</strong> <code>{terminalSession}</code>
                </FlexItem>
                <FlexItem>
                  <Button variant="secondary" size="sm" onClick={closeTerminal}>
                    Close terminal
                  </Button>
                </FlexItem>
              </Flex>
              {terminalError && <Alert variant="danger" isInline title={terminalError} style={{ marginTop: "0.5rem" }} />}
              <div style={{ position: "relative", width: "100%", height: "400px", marginTop: "0.5rem" }}>
                {terminalConnecting && (
                  <Bullseye style={{ position: "absolute", inset: 0, zIndex: 1 }}>
                    <Spinner aria-label="Connecting to terminal" />
                  </Bullseye>
                )}
                <div
                  ref={termHostRef}
                  style={{
                    width: "100%",
                    height: "100%",
                    background: "#0b0d16",
                    borderRadius: "6px",
                    padding: "6px 10px 10px",
                  }}
                />
              </div>
            </CardBody>
          </Card>
        </FlexItem>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <Modal
          isOpen
          variant="small"
          onClose={() => setConfirmDelete(null)}
          aria-label="Confirm session deletion"
        >
          <ModalHeader title="Delete session?" />
          <ModalBody>
            This will tear down the sandbox <code>{confirmDelete}</code> and terminate any running processes.
            This action cannot be undone.
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" onClick={() => void handleDelete(confirmDelete)}>
              Delete
            </Button>
            <Button variant="link" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </Flex>
  );
}
