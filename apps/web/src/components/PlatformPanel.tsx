"use client";

import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  type AapJobTemplate,
  type AapNamedObject,
  type PlatformConnectionStatus,
  type PlatformSettings,
  type PlatformStatus,
  type SecretSummary,
} from "@agentstore/shared";
import {
  AnsibleTowerIcon,
  BuilderImageIcon,
  CubeIcon,
  OpenshiftIcon,
  PficonTemplateIcon,
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
  FormSelect,
  FormSelectOption,
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
  createJobTemplates,
  fetchAgentRuntimeBuildStatus,
  fetchAgentStoreDeployStatus,
  fetchEeBuildStatus,
  fetchJobTemplateBootstrapStatus,
  fetchPlatformStatus,
  fetchSecrets,
  registerExecutionEnvironment,
  startAgentRuntimeBuild,
  startAgentStoreDeploy,
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

function connectionStripState(connection: PlatformConnectionStatus): {
  color: "green" | "red" | "grey";
  text: string;
} {
  if (connection.connected) return { color: "green", text: "Connected" };
  if (connection.configured) return { color: "red", text: "Disconnected" };
  return { color: "grey", text: "Not configured" };
}

/** Resolves a stored job template id against the *live* list of AAP job
 * templates (`status.aap.jobTemplates`, refetched from AAP on every
 * status load) rather than just checking the id is non-empty. This is
 * what catches a template that was deleted directly in AAP after being
 * created/entered here — the id would still be saved in settings, but it
 * no longer resolves to a real template. */
function findJobTemplate(list: AapJobTemplate[], id: number | ""): AapJobTemplate | undefined {
  if (id === "") return undefined;
  return list.find((t) => t.id === Number(id));
}

/** Precise "what just happened" message for the ready state — distinguishes
 * "created new" from "already existed, nothing changed" instead of one
 * generic "ready" message either way (the ambiguity an admin otherwise has
 * no way to resolve after clicking "Create job templates" when they were
 * already there). Falls back to the generic message unless `bootstrap`
 * both succeeded and clearly describes *this exact* pair of ids — guards
 * against showing stale outcome language from a previous run if the ids
 * were since hand-edited, or from settings persisted before this field
 * existed (`autonomousCreated`/`collaborativeCreated` are undefined). */
function describeJobTemplatesReady(
  autonomousTemplate: AapJobTemplate,
  collaborativeTemplate: AapJobTemplate,
  bootstrap: PlatformSettings["aapBootstrap"]
): string {
  const outcomeKnown =
    bootstrap?.status === "running" &&
    bootstrap.autonomousJobTemplateId === autonomousTemplate.id &&
    bootstrap.collaborativeJobTemplateId === collaborativeTemplate.id &&
    bootstrap.autonomousCreated !== undefined &&
    bootstrap.collaborativeCreated !== undefined;

  if (!outcomeKnown) {
    return `Job templates ready — autonomous #${autonomousTemplate.id} ("${autonomousTemplate.name}"), collaborative #${collaborativeTemplate.id} ("${collaborativeTemplate.name}").`;
  }

  const { autonomousCreated, collaborativeCreated } = bootstrap;
  if (autonomousCreated && collaborativeCreated) {
    return `Created 2 new job templates — autonomous #${autonomousTemplate.id}, collaborative #${collaborativeTemplate.id}. Both are ready.`;
  }
  if (!autonomousCreated && !collaborativeCreated) {
    return `Both job templates already existed — autonomous #${autonomousTemplate.id}, collaborative #${collaborativeTemplate.id} — nothing needed to change. They're ready.`;
  }
  const createdRole = autonomousCreated ? "autonomous" : "collaborative";
  const createdId = autonomousCreated ? autonomousTemplate.id : collaborativeTemplate.id;
  const existingRole = autonomousCreated ? "collaborative" : "autonomous";
  return `Created the missing ${createdRole} template (#${createdId}) — the ${existingRole} template already existed. Both are ready now.`;
}

/** Deep link to a Job Template's detail page in the AAP web console,
 * mirroring the `aapJobUrl()` convention in
 * packages/engine-ansible/src/config.ts (which links a job *run*, not the
 * template definition). Returns undefined if no console URL is set. */
function jobTemplateConsoleUrl(consoleUrl: string, id: number): string | undefined {
  const base = consoleUrl.trim().replace(/\/$/, "");
  if (!base) return undefined;
  return `${base}/#/templates/job_template/${id}/details`;
}

/** Maps a strip color to the PatternFly `Icon` status token. "grey" has no
 * built-in status token, so it's left undefined and colored manually via
 * the `--pf-t--global--icon--color--subtle` design token instead. */
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

/** Maps a strip color to the PatternFly design token used to color the
 * status *value* text itself (e.g. "Connected" renders in green, not just
 * its icon) — matches the same success/danger/subtle palette PatternFly
 * uses for alerts and labels elsewhere in the app. */
const STRIP_TEXT_COLOR: Record<"green" | "red" | "grey", string> = {
  green: "var(--pf-t--global--text--color--status--success--default)",
  red: "var(--pf-t--global--text--color--status--danger--default)",
  grey: "var(--pf-t--global--text--color--subtle)",
};

/** One entry in the status strip: a category icon, a muted label, and a
 * bold status value colored green/red/grey to match its state — all on a
 * single line, so the strip stays compact instead of wrapping each item
 * onto two lines. */
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

/** Compact, always-visible "at a glance" status row shown above the Tabs.
 * Tabs necessarily hide each other's detail behind a click, so this row
 * keeps the handful of questions an admin actually needs answered right
 * away (is AAP/OpenShift reachable? is there a built image? are job
 * templates ready?) visible no matter which tab is open — replaces the
 * old full-width "Connections" summary Card, which just duplicated the
 * AAP/OpenShift cards directly below it. Rendered as single-line
 * icon + label + color-coded value stats separated by vertical dividers,
 * rather than a run of uniform "Label: Value" pill badges. */
function PlatformStatusStrip({ status, draft }: { status: PlatformStatus; draft: PlatformSettings }) {
  const aap = connectionStripState(status.aap);
  const openshift = connectionStripState(status.openshift);
  const eeSet = draft.aapExecutionEnvironmentId !== "";
  const runtimeBuilt = Boolean(draft.agentRuntimeImage);
  const templatesReady = Boolean(
    findJobTemplate(status.aap.jobTemplates, draft.aapJobTemplateId) &&
      findJobTemplate(status.aap.jobTemplates, draft.openshellGatewayJobTemplateId)
  );

  return (
    <Card isCompact>
      <CardBody>
        <Flex spaceItems={{ default: "spaceItemsLg" }} flexWrap={{ default: "wrap" }} alignItems={{ default: "alignItemsCenter" }}>
          <FlexItem>
            <PlatformStatusStat icon={<AnsibleTowerIcon />} label="AAP" value={aap.text} color={aap.color} />
          </FlexItem>
          <Divider orientation={{ default: "vertical" }} />
          <FlexItem>
            <PlatformStatusStat icon={<OpenshiftIcon />} label="OpenShift" value={openshift.text} color={openshift.color} />
          </FlexItem>
          <Divider orientation={{ default: "vertical" }} />
          <FlexItem>
            <PlatformStatusStat
              icon={<CubeIcon />}
              label="Execution environment"
              value={eeSet ? "Set" : "Not set"}
              color={eeSet ? "green" : "grey"}
            />
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
            <PlatformStatusStat
              icon={<PficonTemplateIcon />}
              label="Job templates"
              value={templatesReady ? "Created" : "Not created"}
              color={templatesReady ? "green" : "grey"}
            />
          </FlexItem>
        </Flex>
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

  // Live readiness: resolved against `aap.jobTemplates` (refetched from AAP
  // on every status load), not just "is an id saved" — catches a template
  // that was deleted directly in AAP after being created/entered here.
  const autonomousTemplate = findJobTemplate(aap.jobTemplates, draft.aapJobTemplateId);
  const collaborativeTemplate = findJobTemplate(aap.jobTemplates, draft.openshellGatewayJobTemplateId);
  const bothReady = Boolean(autonomousTemplate && collaborativeTemplate);
  const noneReady = !autonomousTemplate && !collaborativeTemplate;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      fetchJobTemplateBootstrapStatus()
        .then(onSettingsUpdate)
        .catch((err: Error) => setError(err.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [running, onSettingsUpdate]);

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

        {noneReady && (
          <Alert
            variant="warning"
            isInline
            title={`Job templates aren't created yet — fill in the fields below and click "Create job templates".`}
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
          </Flex>
          <Content component={ContentVariants.small} style={{ marginTop: "0.5rem" }}>
            Need to build or register a new one? See the <strong>Container images</strong> tab.
          </Content>
        </Form>

        <div style={{ marginTop: "0.75rem" }}>
          <Button variant="primary" isDisabled={busy || running} onClick={() => void create()}>
            {busy ? "Starting…" : running ? `Creating… (${bootstrap?.phase ?? "in progress"})` : "Create job templates"}
          </Button>
        </div>

        {/* Result of the button above — placed right next to it (not up
            near the description) so it's impossible to miss what just
            happened after clicking, instead of requiring a scroll back up
            to a banner near the top of a long form. */}
        {error && <Alert variant="danger" isInline title={error} style={{ marginTop: "0.75rem" }} />}
        {bootstrap?.error && (
          <Alert variant="danger" isInline title={bootstrap.error} style={{ marginTop: "0.75rem" }} />
        )}
        {bothReady ? (
          <Alert
            variant="success"
            isInline
            title={describeJobTemplatesReady(autonomousTemplate!, collaborativeTemplate!, bootstrap)}
            style={{ marginTop: "0.75rem" }}
          />
        ) : (
          !noneReady && (
            <Alert
              variant="warning"
              isInline
              title={
                autonomousTemplate
                  ? `Autonomous template #${autonomousTemplate.id} is ready, but the collaborative template is missing (deleted in AAP, or never created). Click "Create job templates" to (re)create it.`
                  : `Collaborative template #${collaborativeTemplate!.id} is ready, but the autonomous template is missing (deleted in AAP, or never created). Click "Create job templates" to (re)create it.`
              }
              style={{ marginTop: "0.75rem" }}
            />
          )
        )}

        {(autonomousTemplate || collaborativeTemplate) && (
          <div style={{ marginTop: "1rem" }}>
            <Content component={ContentVariants.small} style={{ marginBottom: "0.25rem" }}>
              Current job templates
            </Content>
            <Table aria-label="Current job templates" variant="compact">
              <Thead>
                <Tr>
                  <Th>Role</Th>
                  <Th>Name</Th>
                  <Th>ID</Th>
                  <Th>Link</Th>
                </Tr>
              </Thead>
              <Tbody>
                {[
                  autonomousTemplate ? { role: "Autonomous", template: autonomousTemplate } : null,
                  collaborativeTemplate ? { role: "Collaborative", template: collaborativeTemplate } : null,
                ]
                  .filter((row): row is { role: string; template: AapJobTemplate } => row !== null)
                  .map(({ role, template }) => {
                    const url = jobTemplateConsoleUrl(draft.aapConsoleUrl, template.id);
                    return (
                      <Tr key={role}>
                        <Td dataLabel="Role">{role}</Td>
                        <Td dataLabel="Name">{template.name}</Td>
                        <Td dataLabel="ID">#{template.id}</Td>
                        <Td dataLabel="Link">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer">
                              Open in AAP
                            </a>
                          ) : (
                            "—"
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
              </Tbody>
            </Table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The Execution Environment's "Build from source" / "Register an
 * existing image" admin actions (Admin -> Platform -> Container images
 * tab). An EE is the container image AAP actually runs the two Job
 * Templates' playbooks in — it needs the `kubernetes.core` collection
 * (and `helm`, for the collaborative template). This card only
 * builds/registers the image; the Job templates tab's own "Execution
 * environment" `FormSelect` is where an admin actually picks one of the
 * results here to use. Split out of JobTemplatesCard (which used to own
 * this as two nested toggle-able sub-forms) since it's a different kind
 * of task — building/registering an image, not creating AAP objects.
 */
function ExecutionEnvironmentCard({
  draft,
  aap,
  onSettingsUpdate,
}: {
  draft: PlatformSettings;
  aap: PlatformStatus["aap"];
  onSettingsUpdate: (next: PlatformSettings) => void;
}) {
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
    if (!eeBuildRunning) return;
    const timer = setInterval(() => {
      fetchEeBuildStatus()
        .then(onSettingsUpdate)
        .catch((err: Error) => setStartError(err.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [eeBuildRunning, onSettingsUpdate]);

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
        <IconTitle icon={AnsibleTowerIcon}>Execution Environment</IconTitle>
      </CardTitle>
      <CardBody>
        <Content component={ContentVariants.small}>
          The selected execution environment must already include the{" "}
          <code>kubernetes.core</code> collection (and the <code>helm</code> CLI, for
          the collaborative template) — see{" "}
          <code>ansible/execution-environment/</code> for a ready-to-build
          definition if you don&apos;t have one yet. Build or register one below,
          then pick it on the <strong>Job templates</strong> tab.
        </Content>

        <Content component={ContentVariants.small} style={{ marginTop: "0.5rem" }}>
          {aap.executionEnvironments.length > 0
            ? `Currently registered: ${aap.executionEnvironments.map((e) => `${e.name} (#${e.id})`).join(" · ")}`
            : "None registered yet."}
        </Content>

        {(eeBuild?.error || eeBuildDone) && (
          <Alert
            variant={eeBuild?.error ? "danger" : "success"}
            isInline
            title={
              eeBuild?.error
                ? eeBuild.error
                : `Built and registered execution environment #${eeBuild?.executionEnvironmentId} — select it on the Job templates tab.`
            }
            style={{ marginTop: "0.5rem" }}
          />
        )}

        <Flex spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "0.75rem" }}>
          <FlexItem>
            <Button
              variant="secondary"
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
              variant="secondary"
              onClick={() => {
                setShowRegisterEe((v) => !v);
                setShowBuildEe(false);
              }}
            >
              {showRegisterEe ? "Cancel" : "+ Register a new image…"}
            </Button>
          </FlexItem>
        </Flex>

        {showBuildEe && (
          <Card isCompact isPlain style={{ marginTop: "0.5rem", border: "1px dashed var(--pf-t--global--border--color--100, #ccc)" }}>
            <CardBody>
              <Content component={ContentVariants.small}>
                Builds <code>ansible/execution-environment/Containerfile</code> as an
                OpenShift BuildConfig — source: the Project Git URL/branch on the Job
                templates tab — and pushes the result to OpenShift&apos;s internal
                registry, then registers it in AAP automatically. No local{" "}
                <code>ansible-builder</code>/<code>podman</code> needed; see{" "}
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
 * the console itself to the cluster. Same start/poll pattern as the
 * Agent Sandbox Service card on the OpenShell tab. */
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

        {/* Progress bar + phase description */}
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

        {/* Error detail */}
        {failed && deploy?.error && (
          <Alert variant="danger" isInline isPlain title={deploy.error} style={{ marginTop: "0.75rem" }} />
        )}

        {/* Status details once we have useful info */}
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

        {/* Next step hint */}
        {done && (
          <Alert
            variant="success"
            isInline
            isPlain
            title="AgentStore is running on the cluster. You can now install the Self-service Portal (Red Hat Developer Hub) from the sidebar."
            style={{ marginTop: "0.75rem" }}
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
  const [activeTabKey, setActiveTabKey] = useState<string | number>("connections");

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
        <PlatformStatusStrip status={status} draft={draft} />
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
            </Flex>
          </Tab>

          <Tab eventKey="images" title={<TabTitleText>Container images</TabTitleText>}>
            <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }} style={{ marginTop: "1rem" }}>
              <FlexItem>
                <ExecutionEnvironmentCard draft={draft} aap={status.aap} onSettingsUpdate={applyBootstrapUpdate} />
              </FlexItem>
              <FlexItem>
                <AgentRuntimeCard draft={draft} onSettingsUpdate={applyBootstrapUpdate} />
              </FlexItem>
            </Flex>
          </Tab>

          <Tab eventKey="templates" title={<TabTitleText>Job templates</TabTitleText>}>
            <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }} style={{ marginTop: "1rem" }}>
              <FlexItem>
                <JobTemplatesCard
                  draft={draft}
                  aap={status.aap}
                  onFieldChange={updateDraftField}
                  onSettingsUpdate={applyBootstrapUpdate}
                />
              </FlexItem>
            </Flex>
          </Tab>

        </Tabs>
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
