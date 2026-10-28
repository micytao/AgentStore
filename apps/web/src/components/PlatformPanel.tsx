"use client";

import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  type PlatformConnectionStatus,
  type PlatformSettings,
  type PlatformStatus,
  type SecretSummary,
} from "@agentstore/shared";
import {
  BuilderImageIcon,
  OpenshiftIcon,
  SyncAltIcon,
} from "@patternfly/react-icons";
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
  Divider,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  Icon,
  Label,
  Progress,
  Spinner,
  Tab,
  Tabs,
  TabTitleText,
  TextInput,
  Title,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import { SecretField } from "@/components/SecretField";
import {
  fetchAgentRuntimeBuildStatus,
  fetchAgentStoreDeployStatus,
  fetchPlatformStatus,
  fetchSecrets,
  startAgentRuntimeBuild,
  startAgentStoreDeploy,
  syncStateToCluster,
  testPlatformConnection,
} from "@/lib/api";

/** Coarse phase -> percent mapping for any "Build from source"
 * progress bar — OpenShift doesn't expose a real completion
 * percentage, so this is step-based, not measured. */
function ocpBuildProgressPercent(ocpPhase: string | undefined, running: boolean, done: boolean): number {
  if (done || ocpPhase === "Complete") return 100;
  switch (ocpPhase) {
    case "New":
      return 10;
    case "Pending":
      return 25;
    case "Running":
      return 65;
    default:
      return running ? 5 : 0;
  }
}

type TestOutcome = { ok: boolean; message: string };

function TestBanner({ result, pending }: { result?: TestOutcome; pending?: boolean }) {
  if (pending) {
    return <Alert variant="info" isInline isPlain title="Testing connection…" />;
  }
  if (!result) return null;
  return <Alert variant={result.ok ? "success" : "danger"} isInline isPlain title={result.message} />;
}

/** Icon + text title for section cards. */
function IconTitle({ icon: Icon, children }: { icon: ComponentType; children: ReactNode }) {
  return (
    <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }} flexWrap={{ default: "nowrap" }}>
      <FlexItem style={{ display: "flex" }}>
        <Icon />
      </FlexItem>
      <FlexItem>{children}</FlexItem>
    </Flex>
  );
}

function connectionStripState(connection: PlatformConnectionStatus): {
  color: "green" | "red" | "grey";
  text: string;
} {
  if (connection.connected) return { color: "green", text: "Connected" };
  if (connection.configured) return { color: "red", text: "Disconnected" };
  return { color: "grey", text: "Not configured" };
}

/** Maps a strip color to the PatternFly `Icon` status token. */
const STRIP_ICON_STATUS: Record<"green" | "red" | "grey", "success" | "danger" | undefined> = {
  green: "success",
  red: "danger",
  grey: undefined,
};
const STRIP_ICON_COLOR: Record<"green" | "red" | "grey", string | undefined> = {
  green: undefined,
  red: undefined,
  grey: "var(--pf-t--global--icon--color--subtle)",
};

const STRIP_TEXT_COLOR: Record<"green" | "red" | "grey", string> = {
  green: "var(--pf-t--global--text--color--status--success--default)",
  red: "var(--pf-t--global--text--color--status--danger--default)",
  grey: "var(--pf-t--global--text--color--subtle)",
};

function PlatformStatusStat({
  icon,
  label,
  value,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  color: "green" | "red" | "grey";
}) {
  return (
    <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }} flexWrap={{ default: "nowrap" }}>
      <FlexItem>
        <Icon size="md" status={STRIP_ICON_STATUS[color]} style={{ color: STRIP_ICON_COLOR[color] }}>
          {icon}
        </Icon>
      </FlexItem>
      <FlexItem>
        <Content component={ContentVariants.small} style={{ color: "var(--pf-t--global--text--color--subtle)" }}>
          {label}
        </Content>
      </FlexItem>
      <FlexItem>
        <span style={{ fontWeight: 600, color: STRIP_TEXT_COLOR[color] }}>{value}</span>
      </FlexItem>
    </Flex>
  );
}

/** Compact, always-visible "at a glance" status row shown above the Tabs. */
function PlatformStatusStrip({ status, draft, onRefresh, refreshing }: { status: PlatformStatus; draft: PlatformSettings; onRefresh: () => void; refreshing: boolean }) {
  const openshift = connectionStripState(status.openshift);
  const runtimeBuilt = Boolean(draft.agentRuntimeImage);

  return (
    <Card isCompact>
      <CardBody>
        <Flex spaceItems={{ default: "spaceItemsLg" }} flexWrap={{ default: "wrap" }} alignItems={{ default: "alignItemsCenter" }}>
          <FlexItem>
            <PlatformStatusStat icon={<OpenshiftIcon />} label="OpenShift" value={openshift.text} color={openshift.color} />
          </FlexItem>
          <Divider orientation={{ default: "vertical" }} />
          <FlexItem>
            <PlatformStatusStat
              icon={<BuilderImageIcon />}
              label="Agent runtime image"
              value={runtimeBuilt ? "Built" : "Not built"}
              color={runtimeBuilt ? "green" : "grey"}
            />
          </FlexItem>
          <Divider orientation={{ default: "vertical" }} />
          <FlexItem>
            <Button variant="plain" aria-label="Refresh status" isDisabled={refreshing} onClick={onRefresh}>
              <SyncAltIcon style={refreshing ? { animation: "spin 1s linear infinite" } : undefined} />
            </Button>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
}

/**
 * The agent-runtime image's "Build from source" admin action (Admin ->
 * Platform -> Agent Runtime): builds apps/agent-runtime's chat container
 * as an OpenShift BuildConfig.
 */
function AgentRuntimeCard({
  draft,
  onSettingsUpdate,
}: {
  draft: PlatformSettings;
  onSettingsUpdate: (next: PlatformSettings) => void;
}) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const build = draft.agentRuntimeBuild;
  const running = build?.status === "deploying";
  const done = build?.status === "running";
  const failed = build?.status === "failed";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      fetchAgentRuntimeBuildStatus()
        .then(onSettingsUpdate)
        .catch((err: Error) => setStartError(err.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [running, onSettingsUpdate]);

  async function startBuild() {
    setStarting(true);
    setStartError(null);
    try {
      const next = await startAgentRuntimeBuild({
        projectGitUrl: draft.projectGitUrl,
        projectGitBranch: draft.projectGitBranch,
      });
      onSettingsUpdate(next);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card>
      <CardTitle>
        <IconTitle icon={OpenshiftIcon}>Agent Runtime image</IconTitle>
      </CardTitle>
      <CardBody>
        <Content component={ContentVariants.small}>
          The persistent chat container every generic-chat deploy runs (
          <code>apps/agent-runtime</code>). Without a real image here, deploys
          fail trying to pull the <code>agent-runtime:dev</code> placeholder
          from Docker Hub — nothing publishes that. &quot;Start build&quot;
          builds <code>apps/agent-runtime/Containerfile</code> as an OpenShift
          BuildConfig and pushes the result to OpenShift&apos;s internal
          registry. No local <code>podman</code> needed.
        </Content>

        {startError && <Alert variant="danger" isInline title={startError} style={{ marginTop: "0.5rem" }} />}
        {(build?.error || done) && (
          <Alert
            variant={build?.error ? "danger" : "success"}
            isInline
            title={build?.error ? build.error : `Built image ready: ${build?.image}`}
            style={{ marginTop: "0.5rem" }}
          />
        )}

        <DescriptionList isCompact style={{ marginTop: "0.75rem" }}>
          <DescriptionListGroup>
            <DescriptionListTerm>Current image</DescriptionListTerm>
            <DescriptionListDescription>
              {draft.agentRuntimeImage ? (
                <span title={draft.agentRuntimeImage} style={{ wordBreak: "break-all" }}>
                  {draft.agentRuntimeImage}
                </span>
              ) : (
                <Content component={ContentVariants.small}>
                  Not built yet — deploys fall back to the <code>agent-runtime:dev</code>{" "}
                  placeholder, which fails to pull.
                </Content>
              )}
            </DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>

        <div style={{ marginTop: "0.75rem" }}>
          <Button variant="primary" isDisabled={starting || running} onClick={() => void startBuild()}>
            {starting ? "Starting…" : running ? `Building… (${build?.ocpPhase ?? "starting"})` : "Start build"}
          </Button>
        </div>

        {(running || done || failed) && (
          <Progress
            value={ocpBuildProgressPercent(build?.ocpPhase, running, done)}
            title="OpenShift build"
            label={failed ? "Failed" : build?.ocpPhase ?? "Starting…"}
            variant={failed ? "danger" : done ? "success" : undefined}
            measureLocation="inside"
            style={{ marginTop: "0.75rem", maxWidth: "420px" }}
          />
        )}
      </CardBody>
    </Card>
  );
}

/** Human-readable description of the current deploy phase. */
function agentStorePhaseDescription(deploy: import("@agentstore/shared").AgentStoreDeployStatus | undefined): string {
  if (!deploy) return "";
  if (deploy.status === "failed") return "Deploy failed.";
  if (deploy.status === "running") return "AgentStore is running on the cluster.";
  if (!deploy.image) {
    switch (deploy.ocpPhase) {
      case "New": return "Build queued — waiting for a builder pod…";
      case "Pending": return "Builder pod is starting…";
      case "Running": return "Building the container image (this may take a few minutes)…";
      case "Complete": return "Image built — starting deploy…";
      default: return "Starting the OpenShift build…";
    }
  }
  return "Image ready — applying manifests and waiting for the pod to become ready (30–60s)…";
}

/** Maps the two-phase flow to a progress value out of 100. */
function agentStoreProgressPercent(deploy: import("@agentstore/shared").AgentStoreDeployStatus | undefined): number {
  if (!deploy) return 0;
  if (deploy.status === "running") return 100;
  if (deploy.status === "failed") return 100;
  if (!deploy.image) {
    switch (deploy.ocpPhase) {
      case "New": return 10;
      case "Pending": return 20;
      case "Running": return 50;
      case "Complete": return 75;
      default: return 5;
    }
  }
  return 85;
}

/** "AgentStore on OpenShift" — builds apps/web/Containerfile and deploys
 * the console itself to the cluster. */
function AgentStoreDeployCard({
  settings,
  onSettingsUpdate,
}: {
  settings: PlatformSettings;
  onSettingsUpdate: (s: PlatformSettings) => void;
}) {
  const deploy = settings.agentstoreDeploy;
  const running = deploy?.status === "deploying";
  const done = deploy?.status === "running";
  const failed = deploy?.status === "failed";
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      fetchAgentStoreDeployStatus().then(onSettingsUpdate).catch(console.error);
    }, 4000);
    return () => clearInterval(id);
  }, [running, onSettingsUpdate]);

  async function start() {
    setBusy(true);
    try {
      onSettingsUpdate(await startAgentStoreDeploy());
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncStateToCluster();
      if (result.ok) {
        setSyncResult({ ok: true, message: `State synced to cluster at ${result.syncedAt ?? "now"}.` });
      } else {
        setSyncResult({ ok: false, message: result.error ?? "Sync failed." });
      }
    } catch (err) {
      setSyncResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false);
    }
  }

  const phaseLabel = running
    ? agentStorePhaseDescription(deploy)
    : failed
      ? "Failed"
      : done
        ? "Complete"
        : "";

  return (
    <Card>
      <CardTitle>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
          <FlexItem>
            <IconTitle icon={OpenshiftIcon}>AgentStore on OpenShift</IconTitle>
          </FlexItem>
          <FlexItem>
            <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
              {done && (
                <FlexItem>
                  <Label color="green" isCompact>Running</Label>
                </FlexItem>
              )}
              <FlexItem>
                <Button variant="secondary" isDisabled={busy || running} isLoading={running} onClick={() => void start()}>
                  {running ? "Deploying" : done ? "Redeploy" : failed ? "Retry" : "Deploy"}
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        {!deploy && (
          <Alert
            variant="info"
            isInline
            isPlain
            title="Deploy AgentStore to OpenShift to enable the Self-service Portal (Red Hat Developer Hub). RHDH proxies to AgentStore via the in-cluster Service URL — no external networking required."
            style={{ marginBottom: "0.75rem" }}
          />
        )}
        <Content component={ContentVariants.small}>
          Build <code>apps/web/Containerfile</code> and deploy the AgentStore console to the{" "}
          <code>agentstore</code> namespace on the connected OpenShift cluster.
        </Content>

        {(running || done || failed) && (
          <>
            <Progress
              value={agentStoreProgressPercent(deploy)}
              title="Deploy progress"
              label={phaseLabel}
              variant={failed ? "danger" : done ? "success" : undefined}
              measureLocation="inside"
              style={{ marginTop: "0.75rem", maxWidth: "480px" }}
            />
            {running && (
              <Content component={ContentVariants.small} style={{ marginTop: "0.25rem", fontStyle: "italic", color: "var(--pf-t--global--text--color--subtle)" }}>
                {agentStorePhaseDescription(deploy)}
              </Content>
            )}
          </>
        )}

        {failed && deploy?.error && (
          <Alert variant="danger" isInline isPlain title={deploy.error} style={{ marginTop: "0.75rem" }} />
        )}

        {deploy && (running || done || failed) && (
          <DescriptionList isCompact isHorizontal style={{ marginTop: "0.75rem" }}>
            {deploy.buildName && (
              <DescriptionListGroup>
                <DescriptionListTerm>Build</DescriptionListTerm>
                <DescriptionListDescription>
                  <code>{deploy.buildName}</code>
                  {deploy.ocpPhase && (
                    <Label isCompact style={{ marginLeft: "0.5rem" }}
                      color={deploy.ocpPhase === "Complete" ? "green" : deploy.ocpPhase === "Failed" || deploy.ocpPhase === "Error" ? "red" : "grey"}>
                      {deploy.ocpPhase}
                    </Label>
                  )}
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            <DescriptionListGroup>
              <DescriptionListTerm>Namespace</DescriptionListTerm>
              <DescriptionListDescription><code>agentstore</code></DescriptionListDescription>
            </DescriptionListGroup>
            {deploy.image && (
              <DescriptionListGroup>
                <DescriptionListTerm>Image</DescriptionListTerm>
                <DescriptionListDescription>
                  <code style={{ fontSize: "0.8em", wordBreak: "break-all" }}>{deploy.image}</code>
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {deploy.routeUrl && (
              <DescriptionListGroup>
                <DescriptionListTerm>Route</DescriptionListTerm>
                <DescriptionListDescription>
                  <a href={deploy.routeUrl} target="_blank" rel="noreferrer">{deploy.routeUrl}</a>
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {deploy.updatedAt && (
              <DescriptionListGroup>
                <DescriptionListTerm>Last updated</DescriptionListTerm>
                <DescriptionListDescription>{new Date(deploy.updatedAt).toLocaleString()}</DescriptionListDescription>
              </DescriptionListGroup>
            )}
          </DescriptionList>
        )}

        {done && (
          <Alert
            variant="success"
            isInline
            isPlain
            title="AgentStore is running on the cluster. You can now install the Self-service Portal (Red Hat Developer Hub) from the sidebar."
            style={{ marginTop: "0.75rem" }}
          />
        )}

        {done && (
          <div style={{ marginTop: "1rem" }}>
            <Alert
              variant="warning"
              isInline
              title="Changes you make here (secrets, catalog, providers) are local only."
              style={{ marginBottom: "0.75rem" }}
            >
              <Content component={ContentVariants.small}>
                The on-cluster AgentStore has its own state. Use <strong>Sync to Cluster</strong> to
                push your local configuration without a full redeploy, or <strong>Redeploy</strong> to
                rebuild and reseed everything.
              </Content>
            </Alert>
            <Flex spaceItems={{ default: "spaceItemsMd" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <Button
                  variant="secondary"
                  isDisabled={syncing}
                  isLoading={syncing}
                  onClick={() => void sync()}
                >
                  {syncing ? "Syncing…" : "Sync to Cluster"}
                </Button>
              </FlexItem>
              {deploy.routeUrl && (
                <FlexItem>
                  <Button
                    variant="link"
                    component="a"
                    href={deploy.routeUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open on Cluster ↗
                  </Button>
                </FlexItem>
              )}
            </Flex>
            {syncResult && (
              <Alert
                variant={syncResult.ok ? "success" : "danger"}
                isInline
                isPlain
                title={syncResult.message}
                style={{ marginTop: "0.5rem" }}
              />
            )}
          </div>
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
  const [testing, setTesting] = useState<"openshift" | null>(null);
  const [testResults, setTestResults] = useState<{
    openshift?: TestOutcome;
  }>({});
  const [activeTabKey, setActiveTabKey] = useState<string | number>("connections");
  const [refreshing, setRefreshing] = useState(false);

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
      .catch((err: Error) => setError(err.message))
      .finally(() => setRefreshing(false));
    loadSecrets();
  }

  function refresh() {
    setRefreshing(true);
    load();
  }

  useEffect(load, []);

  async function test(target: "openshift") {
    if (!draft) return;
    setTesting(target);
    setTestResults((prev) => ({ ...prev, [target]: undefined }));
    try {
      const next = await testPlatformConnection(target, draft);
      const conn = next.openshift;
      const outcome: TestOutcome = conn?.connected
        ? { ok: true, message: "OpenShift API is reachable." }
        : { ok: false, message: conn?.error ?? "Connection failed." };
      setDraft(next.settings);
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              settings: next.settings,
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

  function insecureTlsToggle<K extends "openshiftInsecureTls">(key: K) {
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

  const openshiftToken = secrets.find((s) => s.key === "OPENSHIFT_TOKEN");

  /** Applied after build status updates — re-runs the full status load
   * once the build settles so the status strip picks up updated info. */
  function applyBootstrapUpdate(next: PlatformSettings) {
    setDraft(next);
    setStatus((prev) => (prev ? { ...prev, settings: next } : prev));
    if (
      next.agentRuntimeBuild?.status !== "deploying" &&
      next.agentstoreDeploy?.status !== "deploying"
    )
      load();
  }

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }}>
      {error ? (
        <FlexItem>
          <Alert variant="danger" isInline title={error} />
        </FlexItem>
      ) : null}

      <FlexItem>
        <PlatformStatusStrip status={status} draft={draft} onRefresh={refresh} refreshing={refreshing} />
      </FlexItem>

      <FlexItem>
        <Tabs
          activeKey={activeTabKey}
          onSelect={(_e, key) => setActiveTabKey(key)}
          aria-label="Platform sections"
          isBox
        >
          <Tab eventKey="connections" title={<TabTitleText>Connections</TabTitleText>}>
            <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }} style={{ marginTop: "1rem" }}>
      <FlexItem>
        <Card>
          <CardTitle>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <IconTitle icon={OpenshiftIcon}>OpenShift</IconTitle>
              </FlexItem>
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
              <Flex spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "0.5rem" }}>
                <FlexItem flex={{ default: "flex_2" }} style={{ minWidth: "260px" }}>
                  {field("projectGitUrl", "Project Git URL", "https://github.com/your-org/AgentStore.git")}
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "120px" }}>
                  {field("projectGitBranch", "Git branch", "main")}
                </FlexItem>
              </Flex>
            </Form>
            {insecureTlsToggle("openshiftInsecureTls")}
            {openshiftToken && <SecretField secret={openshiftToken} onChange={loadSecrets} />}
          </CardBody>
        </Card>
      </FlexItem>
            </Flex>
          </Tab>

          <Tab eventKey="images" title={<TabTitleText>Container images</TabTitleText>}>
            <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }} style={{ marginTop: "1rem" }}>
              <FlexItem>
                <AgentRuntimeCard draft={draft} onSettingsUpdate={applyBootstrapUpdate} />
              </FlexItem>
            </Flex>
          </Tab>

        </Tabs>
      </FlexItem>

      <FlexItem>
        <Card>
          <CardTitle>
            <IconTitle icon={OpenshiftIcon}>Deployed agents on OpenShift</IconTitle>
          </CardTitle>
          <CardBody>
            <Content component={ContentVariants.small} style={{ marginBottom: "0.5rem" }}>
              Generic-chat agent Deployments only — the OpenShell gateway installs via a
              separate Helm chart into its own namespace and isn&apos;t shown here; see its
              status per-listing in the Catalog instead.
            </Content>
            {status.openshift.deployments.length === 0 ? (
              <Content component={ContentVariants.small}>
                No agent Deployments in {status.settings.openshiftNamespace || "agent-workloads"}.
              </Content>
            ) : (
              <Table aria-label="Deployed agents on OpenShift" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Deployment</Th>
                    <Th>Listing</Th>
                    <Th>Replicas</Th>
                    <Th>Created</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {status.openshift.deployments.map((d) => {
                    const ready = d.replicas > 0 && d.readyReplicas >= d.replicas;
                    const statusColor: "green" | "grey" = ready ? "green" : "grey";
                    return (
                      <Tr key={`${d.namespace}/${d.name}`}>
                        <Td dataLabel="Deployment">{d.name}</Td>
                        <Td dataLabel="Listing">{d.listingId ?? "—"}</Td>
                        <Td dataLabel="Replicas">
                          <Label color={statusColor} isCompact>
                            {d.readyReplicas}/{d.replicas} ready
                          </Label>
                        </Td>
                        <Td dataLabel="Created">
                          {d.creationTimestamp ? new Date(d.creationTimestamp).toLocaleString() : ""}
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

      <FlexItem>
        <AgentStoreDeployCard
          settings={draft}
          onSettingsUpdate={applyBootstrapUpdate}
        />
      </FlexItem>
    </Flex>
  );
}
