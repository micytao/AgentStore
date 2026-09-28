"use client";

import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  type AapNamedObject,
  type PlatformConnectionStatus,
  type PlatformSettings,
  type PlatformStatus,
  type SecretSummary,
} from "@agentstore/shared";
import { AnsibleTowerIcon, OpenshiftIcon } from "@patternfly/react-icons";
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
  FormSelect,
  FormSelectOption,
  Label,
  Progress,
  Spinner,
  TextInput,
  Title,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import { SecretField } from "@/components/SecretField";
import {
  createJobTemplates,
  fetchAgentRuntimeBuildStatus,
  fetchEeBuildStatus,
  fetchJobTemplateBootstrapStatus,
  fetchPlatformStatus,
  fetchSecrets,
  registerExecutionEnvironment,
  startAgentRuntimeBuild,
  startEeImageBuild,
  testPlatformConnection,
} from "@/lib/api";

/** Coarse phase -> percent mapping for any "Build from source"
 * progress bar (the Execution Environment's and the agent-runtime
 * image's alike) — OpenShift doesn't expose a real completion
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

/** Icon + text title, so every AAP/OpenShift card on this page reads as
 * "belonging to" that product at a glance instead of being plain text —
 * same icon+FlexItem CardTitle pattern LandingPage.tsx uses for its value
 * prop cards. */
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

function ConnectionCard({
  name,
  icon,
  connection,
  url,
  details,
  result,
}: {
  name: string;
  icon: ComponentType;
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
    <Card isCompact style={{ height: "100%" }}>
      <CardTitle>
        <IconTitle icon={icon}>{name}</IconTitle>
      </CardTitle>
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

/**
 * "Create job templates" admin action: calls the AAP REST API directly
 * to create the Project/Inventory/Kubernetes-credential/Job-Template
 * objects that launchGenericAgentDeploy() (autonomous) and
 * launchGatewayDeploy() (collaborative) already know how to launch by
 * id — see apps/web/src/server/aapBootstrap.ts. Its "Create job
 * templates" button + polling mirror CatalogManager.tsx's
 * DeploySection exactly, just platform-scoped instead of per-listing.
 */
/** Organization/Project picker: a real `FormSelect` of AAP objects
 * matched by *name* (not id — that's what PlatformSettings stores for
 * these two fields, since findOrganizationByName()/findOrCreateProject()
 * both key off name). Falls back to showing whatever's currently typed
 * as an extra option so a value never gets silently wiped out if AAP
 * hasn't been probed yet or the name isn't in the list (e.g. a Project
 * not created yet). */
function NamedObjectSelect({
  id,
  value,
  options,
  onChange,
  emptyLabel,
}: {
  id: string;
  value: string;
  options: AapNamedObject[];
  onChange: (name: string) => void;
  emptyLabel: string;
}) {
  const hasCurrent = !value || options.some((o) => o.name === value);
  return (
    <FormSelect id={id} value={value} onChange={(_e, v) => onChange(v)}>
      {options.length === 0 && <FormSelectOption value={value} label={value || emptyLabel} />}
      {!hasCurrent && <FormSelectOption value={value} label={`${value} (not in AAP yet)`} />}
      {options.map((o) => (
        <FormSelectOption key={o.id} value={o.name} label={o.name} />
      ))}
    </FormSelect>
  );
}

function JobTemplatesCard({
  draft,
  aap,
  onFieldChange,
  onSettingsUpdate,
}: {
  draft: PlatformSettings;
  aap: PlatformStatus["aap"];
  onFieldChange: <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) => void;
  onSettingsUpdate: (next: PlatformSettings) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootstrap = draft.aapBootstrap;
  const running = bootstrap?.status === "deploying";
  const done = bootstrap?.status === "running";

  const [showRegisterEe, setShowRegisterEe] = useState(false);
  const [newEeName, setNewEeName] = useState("AgentStore execution environment");
  const [newEeImage, setNewEeImage] = useState("");
  const [newEeCredentialId, setNewEeCredentialId] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [showBuildEe, setShowBuildEe] = useState(false);
  const [buildEeName, setBuildEeName] = useState("AgentStore execution environment");
  const [buildEeCredentialId, setBuildEeCredentialId] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const eeBuild = draft.eeBuild;
  const eeBuildRunning = eeBuild?.status === "deploying";
  const eeBuildDone = eeBuild?.status === "running";
  const eeBuildFailed = eeBuild?.status === "failed";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      fetchJobTemplateBootstrapStatus()
        .then(onSettingsUpdate)
        .catch((err: Error) => setError(err.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [running, onSettingsUpdate]);

  useEffect(() => {
    if (!eeBuildRunning) return;
    const timer = setInterval(() => {
      fetchEeBuildStatus()
        .then(onSettingsUpdate)
        .catch((err: Error) => setStartError(err.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [eeBuildRunning, onSettingsUpdate]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const next = await createJobTemplates({
        aapOrganizationName: draft.aapOrganizationName,
        aapProjectName: draft.aapProjectName,
        aapProjectGitUrl: draft.aapProjectGitUrl,
        aapProjectGitBranch: draft.aapProjectGitBranch,
        aapProjectScmCredentialId: draft.aapProjectScmCredentialId,
        aapExecutionEnvironmentId: draft.aapExecutionEnvironmentId,
      });
      onSettingsUpdate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function registerEe() {
    setRegistering(true);
    setRegisterError(null);
    try {
      const next = await registerExecutionEnvironment({
        name: newEeName,
        image: newEeImage,
        credentialId: newEeCredentialId ? Number(newEeCredentialId) : undefined,
      });
      onSettingsUpdate(next);
      setShowRegisterEe(false);
      setNewEeImage("");
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegistering(false);
    }
  }

  async function startBuild() {
    setStarting(true);
    setStartError(null);
    try {
      const next = await startEeImageBuild({
        name: buildEeName,
        credentialId: buildEeCredentialId ? Number(buildEeCredentialId) : undefined,
        settings: {
          aapProjectGitUrl: draft.aapProjectGitUrl,
          aapProjectGitBranch: draft.aapProjectGitBranch,
        },
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
        <IconTitle icon={AnsibleTowerIcon}>AAP Job Templates</IconTitle>
      </CardTitle>
      <CardBody>
        <Content component={ContentVariants.small}>
          Creates the two AAP Job Templates AgentStore launches by id — one for
          autonomous (generic-chat) agent deploys, one for the collaborative
          OpenShell gateway install — plus the Project, Inventory, and Kubernetes
          credential they need. Run this once instead of creating them by hand in
          the AAP web UI.
        </Content>

        {error && <Alert variant="danger" isInline title={error} style={{ marginTop: "0.5rem" }} />}
        {bootstrap?.error && (
          <Alert variant="danger" isInline title={bootstrap.error} style={{ marginTop: "0.5rem" }} />
        )}
        {done && (
          <Alert
            variant="success"
            isInline
            title={`Created job template #${bootstrap?.autonomousJobTemplateId} (autonomous) and #${bootstrap?.collaborativeJobTemplateId} (collaborative) — both fields below are now filled in.`}
            style={{ marginTop: "0.5rem" }}
          />
        )}

        <Form style={{ marginTop: "0.75rem" }}>
          <Flex spaceItems={{ default: "spaceItemsMd" }} flexWrap={{ default: "wrap" }}>
            <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "200px" }}>
              <FormGroup label="Organization" isRequired fieldId="jt-org">
                <NamedObjectSelect
                  id="jt-org"
                  value={draft.aapOrganizationName}
                  options={aap.organizations}
                  onChange={(v) => onFieldChange("aapOrganizationName", v)}
                  emptyLabel="Connect AAP above to load organizations"
                />
              </FormGroup>
            </FlexItem>
            <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "200px" }}>
              <FormGroup label="Existing project (optional)" fieldId="jt-project-pick">
                <FormSelect
                  id="jt-project-pick"
                  value={aap.projects.some((p) => p.name === draft.aapProjectName) ? draft.aapProjectName : "__new__"}
                  onChange={(_e, v) => {
                    if (v !== "__new__") onFieldChange("aapProjectName", v);
                  }}
                >
                  <FormSelectOption value="__new__" label="+ Create new project…" />
                  {aap.projects.map((p) => (
                    <FormSelectOption key={p.id} value={p.name} label={`${p.name} (#${p.id})`} />
                  ))}
                </FormSelect>
              </FormGroup>
            </FlexItem>
            <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "180px" }}>
              <FormGroup label="Project name" isRequired fieldId="jt-project-name">
                <TextInput
                  id="jt-project-name"
                  value={draft.aapProjectName}
                  onChange={(_e, v) => onFieldChange("aapProjectName", v)}
                />
              </FormGroup>
            </FlexItem>
          </Flex>
          <Flex spaceItems={{ default: "spaceItemsMd" }} flexWrap={{ default: "wrap" }} style={{ marginTop: "0.5rem" }}>
            <FlexItem flex={{ default: "flex_2" }} style={{ minWidth: "260px" }}>
              <FormGroup
                label="Project Git URL"
                isRequired
                fieldId="jt-git-url"
              >
                <TextInput
                  id="jt-git-url"
                  value={draft.aapProjectGitUrl}
                  placeholder="https://github.com/your-org/AgentStore.git"
                  onChange={(_e, v) => onFieldChange("aapProjectGitUrl", v)}
                />
              </FormGroup>
            </FlexItem>
            <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "120px" }}>
              <FormGroup label="Branch" fieldId="jt-git-branch">
                <TextInput
                  id="jt-git-branch"
                  value={draft.aapProjectGitBranch}
                  placeholder="main"
                  onChange={(_e, v) => onFieldChange("aapProjectGitBranch", v)}
                />
              </FormGroup>
            </FlexItem>
            <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "220px" }}>
              <FormGroup label="SCM credential (private repos only)" fieldId="jt-scm-cred">
                <FormSelect
                  id="jt-scm-cred"
                  value={String(draft.aapProjectScmCredentialId || "")}
                  onChange={(_e, v) => onFieldChange("aapProjectScmCredentialId", v ? Number(v) : "")}
                >
                  <FormSelectOption value="" label="None (public repo)" />
                  {aap.credentials.map((c) => (
                    <FormSelectOption key={c.id} value={String(c.id)} label={`${c.name} (#${c.id})`} />
                  ))}
                </FormSelect>
              </FormGroup>
            </FlexItem>
          </Flex>
          <Content component={ContentVariants.small} style={{ marginTop: "0.5rem" }}>
            "Project Git URL" must point at your whole AgentStore repo (or fork) —
            not just this <code>ansible/</code> folder — since the job templates
            reference <code>ansible/provision-generic-agent.yml</code> and{" "}
            <code>ansible/provision-openshell-gateway.yml</code> relative to the repo
            root.
          </Content>

          <Flex
            spaceItems={{ default: "spaceItemsMd" }}
            flexWrap={{ default: "wrap" }}
            alignItems={{ default: "alignItemsFlexEnd" }}
            style={{ marginTop: "0.5rem" }}
          >
            <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "220px" }}>
              <FormGroup label="Execution environment" isRequired fieldId="jt-ee">
                <FormSelect
                  id="jt-ee"
                  value={String(draft.aapExecutionEnvironmentId || "")}
                  onChange={(_e, v) => onFieldChange("aapExecutionEnvironmentId", v ? Number(v) : "")}
                >
                  <FormSelectOption value="" label="Select an execution environment…" />
                  {aap.executionEnvironments.map((e) => (
                    <FormSelectOption key={e.id} value={String(e.id)} label={`${e.name} (#${e.id})`} />
                  ))}
                </FormSelect>
              </FormGroup>
            </FlexItem>
            <FlexItem>
              <Button
                variant="link"
                isInline
                onClick={() => {
                  setShowBuildEe((v) => !v);
                  setShowRegisterEe(false);
                }}
              >
                {showBuildEe ? "Cancel" : "+ Build from source"}
              </Button>
            </FlexItem>
            <FlexItem>
              <Button
                variant="link"
                isInline
                onClick={() => {
                  setShowRegisterEe((v) => !v);
                  setShowBuildEe(false);
                }}
              >
                {showRegisterEe ? "Cancel" : "+ Register a new image…"}
              </Button>
            </FlexItem>
          </Flex>
        </Form>

        {(eeBuild?.error || eeBuildDone) && (
          <Alert
            variant={eeBuild?.error ? "danger" : "success"}
            isInline
            title={
              eeBuild?.error
                ? eeBuild.error
                : `Built and registered execution environment #${eeBuild?.executionEnvironmentId} — selected below.`
            }
            style={{ marginTop: "0.5rem" }}
          />
        )}

        {showBuildEe && (
          <Card isCompact isPlain style={{ marginTop: "0.5rem", border: "1px dashed var(--pf-t--global--border--color--100, #ccc)" }}>
            <CardBody>
              <Content component={ContentVariants.small}>
                Builds <code>ansible/execution-environment/Containerfile</code> as an
                OpenShift BuildConfig — source: the Project Git URL/branch above — and
                pushes the result to OpenShift&apos;s internal registry, then registers it
                in AAP automatically. No local <code>ansible-builder</code>/
                <code>podman</code> needed; see{" "}
                <code>ansible/execution-environment/README.md</code> (&quot;Option
                B&quot;) for the caveats (AAP must be able to pull from that registry).
              </Content>
              {startError && (
                <Alert variant="danger" isInline title={startError} style={{ marginTop: "0.5rem" }} />
              )}
              <Flex spaceItems={{ default: "spaceItemsMd" }} flexWrap={{ default: "wrap" }} style={{ marginTop: "0.5rem" }}>
                <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "200px" }}>
                  <FormGroup label="Name" isRequired fieldId="jt-build-ee-name">
                    <TextInput id="jt-build-ee-name" value={buildEeName} onChange={(_e, v) => setBuildEeName(v)} />
                  </FormGroup>
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "220px" }}>
                  <FormGroup label="Registry credential (only if AAP needs one)" fieldId="jt-build-ee-cred">
                    <FormSelect
                      id="jt-build-ee-cred"
                      value={buildEeCredentialId}
                      onChange={(_e, v) => setBuildEeCredentialId(v)}
                    >
                      <FormSelectOption value="" label="None (AAP pulls without one)" />
                      {aap.registryCredentials.map((c) => (
                        <FormSelectOption key={c.id} value={String(c.id)} label={`${c.name} (#${c.id})`} />
                      ))}
                    </FormSelect>
                  </FormGroup>
                </FlexItem>
              </Flex>
              <div style={{ marginTop: "0.5rem" }}>
                <Button
                  variant="secondary"
                  isDisabled={starting || eeBuildRunning || !buildEeName.trim()}
                  onClick={() => void startBuild()}
                >
                  {starting
                    ? "Starting…"
                    : eeBuildRunning
                      ? `Building… (${eeBuild?.ocpPhase ?? "starting"})`
                      : "Start build"}
                </Button>
              </div>

              {(eeBuildRunning || eeBuildDone || eeBuildFailed) && (
                <Progress
                  value={ocpBuildProgressPercent(eeBuild?.ocpPhase, eeBuildRunning, eeBuildDone)}
                  title="OpenShift build"
                  label={eeBuildFailed ? "Failed" : eeBuild?.ocpPhase ?? "Starting…"}
                  variant={eeBuildFailed ? "danger" : eeBuildDone ? "success" : undefined}
                  measureLocation="inside"
                  style={{ marginTop: "0.75rem", maxWidth: "420px" }}
                />
              )}
            </CardBody>
          </Card>
        )}

        {showRegisterEe && (
          <Card isCompact isPlain style={{ marginTop: "0.5rem", border: "1px dashed var(--pf-t--global--border--color--100, #ccc)" }}>
            <CardBody>
              <Content component={ContentVariants.small}>
                Registers an image you&apos;ve already built and pushed as an AAP
                Execution Environment (build steps: see{" "}
                <code>ansible/execution-environment/README.md</code>). Doesn&apos;t
                build or push anything itself — AAP has no API for that.
              </Content>
              {registerError && (
                <Alert variant="danger" isInline title={registerError} style={{ marginTop: "0.5rem" }} />
              )}
              <Flex spaceItems={{ default: "spaceItemsMd" }} flexWrap={{ default: "wrap" }} style={{ marginTop: "0.5rem" }}>
                <FlexItem flex={{ default: "flex_2" }} style={{ minWidth: "260px" }}>
                  <FormGroup label="Image reference" isRequired fieldId="jt-ee-image">
                    <TextInput
                      id="jt-ee-image"
                      value={newEeImage}
                      placeholder="quay.io/your-org/agentstore-ee:latest"
                      onChange={(_e, v) => setNewEeImage(v)}
                    />
                  </FormGroup>
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "180px" }}>
                  <FormGroup label="Name" isRequired fieldId="jt-ee-name">
                    <TextInput id="jt-ee-name" value={newEeName} onChange={(_e, v) => setNewEeName(v)} />
                  </FormGroup>
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "200px" }}>
                  <FormGroup label="Registry credential (private images only)" fieldId="jt-ee-cred">
                    <FormSelect id="jt-ee-cred" value={newEeCredentialId} onChange={(_e, v) => setNewEeCredentialId(v)}>
                      <FormSelectOption value="" label="None (public image)" />
                      {aap.registryCredentials.map((c) => (
                        <FormSelectOption key={c.id} value={String(c.id)} label={`${c.name} (#${c.id})`} />
                      ))}
                    </FormSelect>
                  </FormGroup>
                </FlexItem>
              </Flex>
              <div style={{ marginTop: "0.5rem" }}>
                <Button
                  variant="secondary"
                  isDisabled={registering || !newEeImage.trim() || !newEeName.trim()}
                  onClick={() => void registerEe()}
                >
                  {registering ? "Registering…" : "Register"}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        <Content component={ContentVariants.small} style={{ marginTop: "0.5rem" }}>
          The selected execution environment must already include the{" "}
          <code>kubernetes.core</code> collection (and the <code>helm</code> CLI, for
          the collaborative template) — see{" "}
          <code>ansible/execution-environment/</code> for a ready-to-build
          definition if you don&apos;t have one yet.
        </Content>

        <div style={{ marginTop: "0.75rem" }}>
          <Button variant="primary" isDisabled={busy || running} onClick={() => void create()}>
            {busy ? "Starting…" : running ? `Creating… (${bootstrap?.phase ?? "in progress"})` : "Create job templates"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * The agent-runtime image's "Build from source" admin action (Admin ->
 * Platform -> Agent Runtime): apps/agent-runtime's chat container has
 * no manual-register alternative like the Execution Environment does
 * (there's no AAP object for it to become) — "Start build" is the only
 * path, so this card is deliberately simpler than JobTemplatesCard's
 * EE section: no name/credential mini-form, just a build button and
 * this same progress bar. (No log viewer — see eeBuild.ts's removal
 * history: OpenShift's Build log endpoint proved too unreliable to
 * surface here; use `oc logs -f bc/agentstore-agent-runtime` or the
 * OpenShift console's Build page instead.)
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
        aapProjectGitUrl: draft.aapProjectGitUrl,
        aapProjectGitBranch: draft.aapProjectGitBranch,
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
          BuildConfig — source: the Project Git URL/branch on the AAP Job
          Templates card above — and pushes the result to OpenShift&apos;s
          internal registry. No local <code>podman</code> needed.
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

  function updateDraftField<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  /** Applied after createJobTemplates()/fetchJobTemplateBootstrapStatus()
   * — both return the freshly-saved PlatformSettings, which already
   * includes any newly-populated aapJobTemplateId/
   * openshellGatewayJobTemplateId. Re-runs the full status load once the
   * bootstrap settles so the AAP controller card's "Templates: ..." list
   * and Recent AAP jobs table pick up the newly created objects too. */
  function applyBootstrapUpdate(next: PlatformSettings) {
    setDraft(next);
    setStatus((prev) => (prev ? { ...prev, settings: next } : prev));
    if (
      next.aapBootstrap?.status !== "deploying" &&
      next.eeBuild?.status !== "deploying" &&
      next.agentRuntimeBuild?.status !== "deploying"
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
        <Card>
          <CardTitle>Connections</CardTitle>
          <CardBody>
            <Content component={ContentVariants.p}>
              AgentStore is a console. It talks to Ansible Automation Platform to
              provision, and to OpenShift to watch the Job that actually
              runs. URLs and tokens for both are configured below.
            </Content>
            <Flex
              spaceItems={{ default: "spaceItemsMd" }}
              alignItems={{ default: "alignItemsStretch" }}
              flexWrap={{ default: "wrap" }}
            >
              <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "300px" }}>
                <ConnectionCard
                  name="Ansible Automation Platform"
                  icon={AnsibleTowerIcon}
                  connection={status.aap}
                  url={status.aap.configured ? status.settings.aapControllerUrl : undefined}
                  result={testResults.aap}
                />
              </FlexItem>
              <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "300px" }}>
                <ConnectionCard
                  name="OpenShift"
                  icon={OpenshiftIcon}
                  connection={status.openshift}
                  url={status.openshift.configured ? status.settings.openshiftApiUrl : undefined}
                  details={
                    status.openshift.configured
                      ? [{ label: "Namespace", value: status.settings.openshiftNamespace || "agent-workloads" }]
                      : undefined
                  }
                  result={testResults.openshift}
                />
              </FlexItem>
            </Flex>
          </CardBody>
        </Card>
      </FlexItem>

      <FlexItem>
        <Card>
          <CardTitle>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <IconTitle icon={AnsibleTowerIcon}>AAP controller</IconTitle>
              </FlexItem>
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
            </Form>
            {insecureTlsToggle("openshiftInsecureTls")}
            {openshiftToken && <SecretField secret={openshiftToken} onChange={loadSecrets} />}
          </CardBody>
        </Card>
      </FlexItem>

      <FlexItem>
        <JobTemplatesCard
          draft={draft}
          aap={status.aap}
          onFieldChange={updateDraftField}
          onSettingsUpdate={applyBootstrapUpdate}
        />
      </FlexItem>

      <FlexItem>
        <AgentRuntimeCard draft={draft} onSettingsUpdate={applyBootstrapUpdate} />
      </FlexItem>

      <FlexItem>
        <Card>
          <CardTitle>
            <IconTitle icon={AnsibleTowerIcon}>Recent AAP jobs</IconTitle>
          </CardTitle>
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
          <CardTitle>
            <IconTitle icon={OpenshiftIcon}>Agent Jobs on OpenShift</IconTitle>
          </CardTitle>
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
