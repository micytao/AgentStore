"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  BookIcon,
  BrainIcon,
  CloudIcon,
  NetworkIcon,
  PlugIcon,
  TasksIcon,
  TerminalIcon,
  ThLargeIcon,
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
  ExpandableSection,
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
  PageSection,
  SearchInput,
  Spinner,
  Tab,
  Tabs,
  TabTitleIcon,
  TabTitleText,
  TextArea,
  TextInput,
  Title,
  Wizard,
  WizardFooterWrapper,
  WizardHeader,
  WizardStep,
  useWizardContext,
} from "@patternfly/react-core";
import { ExpandableRowContent, Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import {
  DEPARTMENTS,
  departmentLabel,
  deriveAgentMode,
  PROVIDER_KINDS,
  type AgentRuntime,
  type DepartmentId,
  type EngineType,
  type GatewayWorkloadKind,
  type Listing,
  type ListingUpdate,
  type McpServerStatus,
  type McpTransport,
  type Pricing,
  type PricingUnit,
  type ProviderConfig,
  type ProviderKind,
  type ProviderStatus,
  type ReviewStatus,
  type RiskTier,
  type SecretSummary,
  type Skill,
} from "@agentstore/shared";
import { ListingCard } from "@/components/ListingCard";
import { Markdown } from "@/components/Markdown";
import { PhaseLabel } from "@/components/PhaseLabel";
import { PlatformPanel } from "@/components/PlatformPanel";
import { SecretField } from "@/components/SecretField";
import {
  activateProviderConfig,
  connectMcpServerConfig,
  createListingAdmin,
  deleteListingAdmin,
  deleteMcpServerConfig,
  deleteProviderConfig,
  deleteSkillConfig,
  deployGateway,
  deployListingAdmin,
  disconnectMcpServerConfig,
  fetchDeploymentStatus,
  fetchEngineSettings,
  fetchGatewayStatus,
  fetchListings,
  fetchMcpServers,
  fetchPlatformStatus,
  fetchProviders,
  fetchSecrets,
  fetchSkills,
  fetchTasks,
  importRedHatSkills,
  setMcpAuthTokenValue,
  setMcpToolEnabledValue,
  setProviderKeyValue,
  testProviderConnection,
  updateListingAdmin,
  updatePlatformSettings,
  upsertMcpServerConfig,
  upsertProviderConfig,
  upsertSkillConfig,
  type EngineSettings,
  type PlatformStatus,
  type Task,
} from "@/lib/api";
import { formatUsd, modeLabel } from "@/lib/format";
import { useRole } from "@/lib/role";

type AdminTabId = "catalog" | "platform" | "llms" | "skills" | "audit";

const TABS: { id: AdminTabId; label: string; icon: ComponentType }[] = [
  { id: "catalog", label: "Catalog", icon: ThLargeIcon },
  { id: "platform", label: "Platform", icon: CloudIcon },
  { id: "llms", label: "LLMs", icon: BrainIcon },
  { id: "skills", label: "Skills", icon: BookIcon },
  { id: "audit", label: "Tasks & usage", icon: TasksIcon },
];

const PRICING_UNITS: { id: PricingUnit; label: string }[] = [
  { id: "per-task", label: "/ task" },
  { id: "per-hour", label: "/ hour" },
];

const DEFAULT_PRICING: Pricing = { unit: "per-task", amount: 0.8 };

const RISK_TIERS: RiskTier[] = ["low", "medium", "high"];
const REVIEW_STATUSES: ReviewStatus[] = [
  "draft",
  "in-review",
  "published",
  "deprecated",
];

// Human-readable labels for the Red Hat Agentic Skill Pack ids imported by
// scripts/import-redhat-skills.ts — falls back to the raw pack id (or
// "Custom skills" for skills authored in this app) for anything unmapped.
const PACK_LABELS: Record<string, string> = {
  "rh-basic": "Red Hat Basics",
  "rh-sre": "Red Hat SRE",
  "rh-developer": "Red Hat Developer",
  "rh-virt": "Red Hat Virtualization",
  "ocp-admin": "OpenShift Admin",
  "rh-ai-engineer": "Red Hat AI Engineer",
  "rh-automation": "Red Hat Automation",
};

function packLabel(pack: string): string {
  if (pack === "custom") return "Custom skills";
  return PACK_LABELS[pack] ?? pack;
}

interface SkillGroup {
  key: string;
  label: string;
  skills: Skill[];
}

/** Groups skills by `pack` (skills with no pack, e.g. user-authored ones,
 * fall into a "custom" group), sorted alphabetically by label with
 * "custom" always last so home-grown skills don't get buried among the
 * Red Hat packs. */
function groupSkillsByPack(skills: Skill[]): SkillGroup[] {
  const byKey = new Map<string, Skill[]>();
  for (const skill of skills) {
    const key = skill.pack ?? "custom";
    const bucket = byKey.get(key);
    if (bucket) bucket.push(skill);
    else byKey.set(key, [skill]);
  }
  return [...byKey.entries()]
    .map(([key, groupSkills]) => ({ key, label: packLabel(key), skills: groupSkills }))
    .sort((a, b) => {
      if (a.key === "custom") return 1;
      if (b.key === "custom") return -1;
      return a.label.localeCompare(b.label);
    });
}

/** Toggle content for the `ExpandableSection`s used to group skills by pack
 * in the skill picker and the skills library — a label plus a count/selection
 * badge. */
function skillGroupToggle(label: string, badge?: string) {
  return (
    <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }} display={{ default: "inlineFlex" }}>
      <FlexItem>{label}</FlexItem>
      {badge && (
        <FlexItem>
          <Label isCompact>{badge}</Label>
        </FlexItem>
      )}
    </Flex>
  );
}

export function AdminPage() {
  const { isAdmin, loading, setRole } = useRole();

  if (loading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Checking session" />
        </Bullseye>
      </PageSection>
    );
  }

  if (!isAdmin) {
    return (
      <PageSection isWidthLimited>
        <Content>
          <Content component={ContentVariants.small}>Restricted</Content>
          <Title headingLevel="h1" size="lg">
            Admin console
          </Title>
        </Content>
        <Alert variant="info" isInline title="Admin mode is off" style={{ marginTop: "1rem" }}>
          <p>
            Switch to Admin to manage the catalog, onboard new agents, choose
            which engine tasks run on, and audit everything launched across
            departments.
          </p>
          <Button variant="primary" onClick={() => void setRole("admin")} style={{ marginTop: "0.75rem" }}>
            Switch to Admin
          </Button>
        </Alert>
      </PageSection>
    );
  }

  return <AdminConsole />;
}

function AdminConsole() {
  const [tab, setTab] = useState<AdminTabId>("catalog");

  return (
    <>
      <PageSection variant="secondary">
        <Content>
          <Content component={ContentVariants.small}>Admin console</Content>
          <Title headingLevel="h1" size="2xl">
            Configure the store
          </Title>
          <Content component={ContentVariants.p}>
            Manage catalog listings, choose which engine tasks run on, and
            audit every task launched across departments.
          </Content>
        </Content>
      </PageSection>

      <PageSection type="tabs">
        <Tabs
          activeKey={tab}
          onSelect={(_event, eventKey) => setTab(eventKey as AdminTabId)}
          aria-label="Admin sections"
        >
          {TABS.map((item) => {
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
      </PageSection>

      <PageSection>
        {tab === "catalog" && <CatalogManager />}
        {tab === "platform" && <PlatformPanel />}
        {tab === "llms" && <LLMsPanel />}
        {tab === "skills" && <SkillsPanel />}
        {tab === "audit" && <AuditLog />}
      </PageSection>
    </>
  );
}

function CatalogManager() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  function loadAll() {
    Promise.all([fetchListings(), fetchProviders(), fetchMcpServers(), fetchSkills()])
      .then(([l, p, m, s]) => {
        setListings(l);
        setProviders(p);
        setMcpServers(m);
        setSkills(s);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(loadAll, []);

  if (error) return <Alert variant="danger" isInline title={error} />;
  if (!listings) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading catalog" />
      </Bullseye>
    );
  }

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }}>
      <FlexItem>
        <Title headingLevel="h3" size="lg">
          Catalog listings
        </Title>
        <Content component={ContentVariants.small}>
          Adjust risk tier, review status, and price per listing — changes
          save immediately. Expand a row to bind a provider, tools, skills,
          and the AAP job template, or delete the agent entirely.
        </Content>
      </FlexItem>

      <FlexItem>
        <Table aria-label="Catalog listings">
          <Thead>
            <Tr>
              <Th width={30}>Listing</Th>
              <Th modifier="nowrap">Risk tier</Th>
              <Th modifier="nowrap">Review status</Th>
              <Th modifier="nowrap">Price</Th>
              <Th screenReaderText="Actions" />
            </Tr>
          </Thead>
          {listings.map((listing) => (
            <ListingRow
              key={listing.id}
              listing={listing}
              providers={providers}
              mcpServers={mcpServers}
              skills={skills}
              onChange={loadAll}
            />
          ))}
        </Table>
      </FlexItem>

      <FlexItem>
        {showWizard ? (
          <OnboardAgentWizard
            providers={providers}
            mcpServers={mcpServers}
            skills={skills}
            onDone={() => {
              setShowWizard(false);
              loadAll();
            }}
            onCancel={() => setShowWizard(false)}
          />
        ) : (
          <Button variant="primary" onClick={() => setShowWizard(true)}>
            + Onboard new agent
          </Button>
        )}
      </FlexItem>
    </Flex>
  );
}

function ListingRow({
  listing,
  providers,
  mcpServers,
  skills,
  onChange,
}: {
  listing: Listing;
  providers: ProviderStatus[];
  mcpServers: McpServerStatus[];
  skills: Skill[];
  onChange: () => void;
}) {
  const [draft, setDraft] = useState<Required<Pick<ListingUpdate, "name" | "description" | "riskTier" | "reviewStatus" | "pricing">>>({
    name: listing.name,
    description: listing.description,
    riskTier: listing.riskTier,
    reviewStatus: listing.reviewStatus,
    pricing: listing.pricing ?? DEFAULT_PRICING,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function update(patch: ListingUpdate) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await updateListingAdmin(listing.id, draft);
      setSaved(true);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${listing.name}"? It disappears from the catalog immediately.`)) return;
    setDeleting(true);
    try {
      await deleteListingAdmin(listing.id);
      onChange();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Tbody isExpanded={showConfig}>
      <Tr>
        <Td dataLabel="Listing">
          <strong>{listing.name}</strong>
          <br />
          <Content component={ContentVariants.small}>
            {departmentLabel(listing.department)} · {listing.category}
            {listing.source === "custom" ? " · Custom" : ""}
          </Content>
        </Td>
        <Td dataLabel="Risk tier">
          <FormSelect
            aria-label={`Risk tier for ${listing.name}`}
            value={draft.riskTier}
            onChange={(_e, v) => update({ riskTier: v as RiskTier })}
          >
            {RISK_TIERS.map((tier) => (
              <FormSelectOption key={tier} value={tier} label={tier} />
            ))}
          </FormSelect>
        </Td>
        <Td dataLabel="Review status">
          <FormSelect
            aria-label={`Review status for ${listing.name}`}
            value={draft.reviewStatus}
            onChange={(_e, v) => update({ reviewStatus: v as ReviewStatus })}
          >
            {REVIEW_STATUSES.map((status) => (
              <FormSelectOption key={status} value={status} label={status} />
            ))}
          </FormSelect>
        </Td>
        <Td dataLabel="Price">
          <InputGroup>
            <InputGroupItem>
              <TextInput
                style={{ width: "5rem" }}
                aria-label={`Price amount for ${listing.name}`}
                inputMode="decimal"
                value={String(draft.pricing.amount)}
                onChange={(_e, v) => update({ pricing: { ...draft.pricing, amount: Number(v) || 0 } })}
              />
            </InputGroupItem>
            <InputGroupItem>
              <FormSelect
                aria-label={`Price unit for ${listing.name}`}
                value={draft.pricing.unit}
                onChange={(_e, v) => update({ pricing: { ...draft.pricing, unit: v as PricingUnit } })}
              >
                {PRICING_UNITS.map((u) => (
                  <FormSelectOption key={u.id} value={u.id} label={u.label} />
                ))}
              </FormSelect>
            </InputGroupItem>
          </InputGroup>
        </Td>
        <Td dataLabel="Actions" modifier="fitContent">
          <Flex spaceItems={{ default: "spaceItemsSm" }} flexWrap={{ default: "nowrap" }}>
            <FlexItem>
              <Button variant={saved ? "secondary" : "primary"} size="sm" onClick={() => void save()} isDisabled={saving}>
                {saving ? "Saving…" : saved ? "Saved" : "Save"}
              </Button>
            </FlexItem>
            <FlexItem>
              <Button variant="secondary" size="sm" onClick={() => setShowConfig((v) => !v)}>
                {showConfig ? "Hide config" : "Agent config"}
              </Button>
            </FlexItem>
            <FlexItem>
              <Button variant="danger" size="sm" onClick={() => void remove()} isDisabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </FlexItem>
          </Flex>
        </Td>
      </Tr>
      {showConfig && (
        <Tr isExpanded>
          <Td colSpan={5}>
            <ExpandableRowContent>
              <AgentConfigPanel
                listing={listing}
                providers={providers}
                mcpServers={mcpServers}
                skills={skills}
                onChange={onChange}
              />
            </ExpandableRowContent>
          </Td>
        </Tr>
      )}
    </Tbody>
  );
}

/** Search-filterable, collapsible-by-pack replacement for a flat skill
 * checkbox list — shared by AgentConfigPanel and OnboardAgentWizard step 3,
 * which both just need "which skill ids are selected" in/out. */
function SkillPicker({
  skills,
  selectedIds,
  onToggle,
}: {
  skills: Skill[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupSkillsByPack(skills), [skills]);

  // Seeded once so a listing being edited shows its already-selected
  // skills' groups open immediately, without fighting the user's manual
  // open/closed choices on every re-render.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const group of groups) {
      if (group.skills.some((s) => selectedIds.includes(s.id))) initial.add(group.key);
    }
    return initial;
  });

  const trimmedQuery = query.trim().toLowerCase();
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      skills: trimmedQuery
        ? group.skills.filter(
            (s) =>
              s.name.toLowerCase().includes(trimmedQuery) ||
              s.description.toLowerCase().includes(trimmedQuery)
          )
        : group.skills,
    }))
    .filter((group) => group.skills.length > 0);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
      <FlexItem>
        <SearchInput
          aria-label="Search skills"
          placeholder="Search skills by name or description…"
          value={query}
          onChange={(_e, v) => setQuery(v)}
          onClear={() => setQuery("")}
        />
      </FlexItem>

      {filteredGroups.length === 0 && (
        <FlexItem>
          <Content component={ContentVariants.small}>No skills match &quot;{query}&quot;.</Content>
        </FlexItem>
      )}

      {filteredGroups.map((group) => {
        const selectedCount = group.skills.filter((s) => selectedIds.includes(s.id)).length;
        const isOpen = trimmedQuery.length > 0 || openGroups.has(group.key);
        return (
          <FlexItem key={group.key}>
            <ExpandableSection
              toggleContent={skillGroupToggle(group.label, selectedCount > 0 ? `${selectedCount} selected` : `${group.skills.length}`)}
              isExpanded={isOpen}
              onToggle={() => toggleGroup(group.key)}
            >
              <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsSm" }}>
                {group.skills.map((skill) => (
                  <FlexItem key={skill.id}>
                    <Checkbox
                      id={`skill-picker-${skill.id}`}
                      isChecked={selectedIds.includes(skill.id)}
                      onChange={() => onToggle(skill.id)}
                      label={
                        <>
                          <strong>{skill.name}</strong>
                          {skill.description && (
                            <Content component={ContentVariants.small}>{skill.description}</Content>
                          )}
                        </>
                      }
                    />
                  </FlexItem>
                ))}
              </Flex>
            </ExpandableSection>
          </FlexItem>
        );
      })}
    </Flex>
  );
}

function AgentConfigPanel({
  listing,
  providers,
  mcpServers,
  skills,
  onChange,
}: {
  listing: Listing;
  providers: ProviderStatus[];
  mcpServers: McpServerStatus[];
  skills: Skill[];
  onChange: () => void;
}) {
  const [providerId, setProviderId] = useState(listing.agentConfig?.providerId ?? "");
  const [engineOverride, setEngineOverride] = useState<"auto" | "simulated" | "live">(
    listing.agentConfig?.engineOverride ?? "auto"
  );
  const [skillIds, setSkillIds] = useState<string[]>(listing.agentConfig?.skillIds ?? []);
  const [toolBindings, setToolBindings] = useState<{ serverId: string; tool: string }[]>(
    listing.agentConfig?.mcpToolBindings ?? []
  );
  const [aapJobTemplateId, setAapJobTemplateId] = useState(
    listing.agentConfig?.aapJobTemplateId ? String(listing.agentConfig.aapJobTemplateId) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const connectedServers = mcpServers.filter((s) => s.connectionState === "connected");

  function toggleTool(serverId: string, tool: string) {
    setSaved(false);
    setToolBindings((prev) =>
      prev.some((b) => b.serverId === serverId && b.tool === tool)
        ? prev.filter((b) => !(b.serverId === serverId && b.tool === tool))
        : [...prev, { serverId, tool }]
    );
  }

  function toggleSkill(id: string) {
    setSaved(false);
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function save() {
    setSaving(true);
    try {
      await updateListingAdmin(listing.id, {
        agentConfig: {
          providerId: providerId || undefined,
          engineOverride,
          skillIds,
          mcpToolBindings: toolBindings,
          aapJobTemplateId: aapJobTemplateId.trim()
            ? Number(aapJobTemplateId)
            : undefined,
        },
      });
      setSaved(true);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }}>
      <FlexItem>
        <Title headingLevel="h4" size="md">
          Agent config — {listing.name}
        </Title>
        <Content component={ContentVariants.small}>
          Bind a specific model provider, tool subset, skills, AAP job template,
          and engine override to this agent. Leave provider unset to keep using
          the global active provider. Leave the AAP template unset to use the
          Platform default.
          {listing.runtime === "generic-chat" && (
            <>
              {" "}For this generic-chat listing, the AAP job template must
              launch <code>provision-generic-agent.yml</code>, not the one-shot
              playbook.
            </>
          )}
        </Content>
      </FlexItem>

      <FlexItem>
        <Form>
          <Flex spaceItems={{ default: "spaceItemsMd" }}>
            <FlexItem flex={{ default: "flex_1" }}>
              <FormGroup label="Model provider" fieldId="agent-config-provider">
                <FormSelect
                  id="agent-config-provider"
                  value={providerId}
                  onChange={(_e, v) => {
                    setProviderId(v);
                    setSaved(false);
                  }}
                >
                  <FormSelectOption value="" label="Use global active provider" />
                  {providers.map((p) => (
                    <FormSelectOption key={p.id} value={p.id} label={p.label} />
                  ))}
                </FormSelect>
              </FormGroup>
            </FlexItem>
            <FlexItem flex={{ default: "flex_1" }}>
              <FormGroup label="Engine" fieldId="agent-config-engine">
                <FormSelect
                  id="agent-config-engine"
                  value={engineOverride}
                  onChange={(_e, v) => {
                    setEngineOverride(v as "auto" | "simulated" | "live");
                    setSaved(false);
                  }}
                >
                  <FormSelectOption value="auto" label="Auto (use global engine setting)" />
                  <FormSelectOption value="simulated" label="Force simulated" />
                  <FormSelectOption value="live" label="Force live (AAP or OpenShell)" />
                </FormSelect>
              </FormGroup>
            </FlexItem>
            <FlexItem flex={{ default: "flex_1" }}>
              <FormGroup label="AAP job template id" fieldId="agent-config-aap-template">
                <TextInput
                  id="agent-config-aap-template"
                  inputMode="numeric"
                  placeholder="Platform default"
                  value={aapJobTemplateId}
                  onChange={(_e, v) => {
                    setAapJobTemplateId(v);
                    setSaved(false);
                  }}
                />
              </FormGroup>
            </FlexItem>
          </Flex>
        </Form>
      </FlexItem>

      <FlexItem>
        <Title headingLevel="h5" size="md">
          Tools
        </Title>
        {connectedServers.length === 0 ? (
          <Content component={ContentVariants.small}>
            No connected MCP servers. Connect one in the MCP tab first.
          </Content>
        ) : (
          <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
            {connectedServers.map((server) => (
              <FlexItem key={server.id}>
                <strong>{server.name}</strong>
                {server.tools.length === 0 ? (
                  <Content component={ContentVariants.small}>No tools advertised.</Content>
                ) : (
                  <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsXs" }}>
                    {server.tools.map((tool) => (
                      <FlexItem key={tool.name}>
                        <Checkbox
                          id={`agent-config-tool-${server.id}-${tool.name}`}
                          label={tool.name}
                          isChecked={toolBindings.some((b) => b.serverId === server.id && b.tool === tool.name)}
                          onChange={() => toggleTool(server.id, tool.name)}
                        />
                      </FlexItem>
                    ))}
                  </Flex>
                )}
              </FlexItem>
            ))}
          </Flex>
        )}
      </FlexItem>

      <FlexItem>
        <Title headingLevel="h5" size="md">
          Skills
        </Title>
        {skills.length === 0 ? (
          <Content component={ContentVariants.small}>No skills authored yet. Add one in the Skills tab.</Content>
        ) : (
          <SkillPicker skills={skills} selectedIds={skillIds} onToggle={toggleSkill} />
        )}
      </FlexItem>

      <FlexItem>
        <Button variant="primary" onClick={() => void save()} isDisabled={saving}>
          {saving ? "Saving…" : saved ? "Saved" : "Save agent config"}
        </Button>
      </FlexItem>

      {listing.runtime === "generic-chat" && (
        <FlexItem>
          <DeploySection listing={listing} onChange={onChange} />
        </FlexItem>
      )}
    </Flex>
  );
}

/** "Deploy to OpenShift" action for a generic-chat listing: launches (or
 * re-launches) provision-generic-agent.yml via AAP and polls
 * GET .../deploy while in flight, same inline-progress idea
 * TaskDetailPage.tsx uses for Task provisioning — but here it's a one-time,
 * per-listing action instead of once per Task. */
function DeploySection({ listing, onChange }: { listing: Listing; onChange: () => void }) {
  const [deployment, setDeployment] = useState(listing.deployment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDeployment(listing.deployment);
  }, [listing.deployment]);

  useEffect(() => {
    if (deployment?.status !== "deploying") return;
    const timer = setInterval(() => {
      fetchDeploymentStatus(listing.id)
        .then((next) => {
          setDeployment(next.deployment);
          if (next.deployment?.status !== "deploying") onChange();
        })
        .catch((err: Error) => setError(err.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [deployment?.status, listing.id, onChange]);

  async function deploy() {
    setBusy(true);
    setError(null);
    try {
      const updated = await deployListingAdmin(listing.id);
      setDeployment(updated.deployment);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const status = deployment?.status ?? "not-deployed";
  const statusColor: "green" | "red" | "grey" = status === "running" ? "green" : status === "failed" ? "red" : "grey";

  return (
    <Card isCompact>
      <CardTitle>Deploy to OpenShift</CardTitle>
      <CardBody>
        <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
          <FlexItem>
            <Content component={ContentVariants.small}>
              Generic-chat agents are provisioned once: AAP creates a persistent
              Deployment + Route on OpenShift, and every user opens the same
              running agent from its link — no per-launch provisioning.
            </Content>
          </FlexItem>

          {error && (
            <FlexItem>
              <Alert variant="danger" isInline title={error} />
            </FlexItem>
          )}
          {deployment?.error && (
            <FlexItem>
              <Alert variant="danger" isInline title={deployment.error} />
            </FlexItem>
          )}

          <FlexItem>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <strong>Status</strong>
                <Content component={ContentVariants.small}>
                  {deployment?.updatedAt ? `Updated ${new Date(deployment.updatedAt).toLocaleString()}` : "Never deployed"}
                </Content>
              </FlexItem>
              <FlexItem>
                <Label color={statusColor} isCompact>
                  {status}
                </Label>
              </FlexItem>
            </Flex>
          </FlexItem>

          {(deployment?.aapJobUrl || (status === "running" && deployment?.routeUrl)) && (
            <FlexItem>
              <Content component={ContentVariants.small}>
                {deployment?.aapJobUrl && (
                  <>
                    <a href={deployment.aapJobUrl} target="_blank" rel="noreferrer">
                      View AAP job →
                    </a>
                    {"  "}
                  </>
                )}
                {status === "running" && deployment?.routeUrl && (
                  <a href={deployment.routeUrl} target="_blank" rel="noreferrer">
                    Open agent →
                  </a>
                )}
              </Content>
            </FlexItem>
          )}

          <FlexItem>
            <Button variant="primary" onClick={() => void deploy()} isDisabled={busy || status === "deploying"}>
              {busy
                ? "Starting…"
                : status === "deploying"
                  ? "Deploying…"
                  : status === "running"
                    ? "Redeploy"
                    : "Deploy to OpenShift"}
            </Button>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
}

const ICON_OPTIONS: { id: string; label: string }[] = [
  { id: "code", label: "Code" },
  { id: "comments", label: "Comments" },
  { id: "shield", label: "Shield" },
  { id: "chart", label: "Chart" },
  { id: "money", label: "Money" },
  { id: "headset", label: "Headset" },
  { id: "server", label: "Server" },
];

/** Footer for wizard steps that must validate before advancing — `onNext`
 * runs the step's validation and returns an error message (blocking the
 * advance) or null (clear to proceed). */
function WizardStepFooter({
  onNext,
  onCancel,
}: {
  onNext: () => string | null;
  onCancel: () => void;
}) {
  const { goToNextStep, goToPrevStep, activeStep } = useWizardContext();
  return (
    <WizardFooterWrapper>
      <Button variant="secondary" onClick={() => void goToPrevStep()} isDisabled={activeStep.index === 1}>
        Back
      </Button>
      <Button
        variant="primary"
        onClick={() => {
          if (onNext() === null) void goToNextStep();
        }}
      >
        Next
      </Button>
      <Button variant="link" onClick={onCancel}>
        Cancel
      </Button>
    </WizardFooterWrapper>
  );
}

/** Footer for the final "Review & publish" step — replaces Next with the
 * two real submit actions. */
function ReviewWizardStepFooter({
  onCancel,
  onSaveDraft,
  onPublish,
  saving,
}: {
  onCancel: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  saving: boolean;
}) {
  const { goToPrevStep } = useWizardContext();
  return (
    <WizardFooterWrapper>
      <Button variant="secondary" onClick={() => void goToPrevStep()} isDisabled={saving}>
        Back
      </Button>
      <Button variant="link" onClick={onCancel} isDisabled={saving}>
        Cancel
      </Button>
      <Button variant="secondary" onClick={onSaveDraft} isDisabled={saving}>
        {saving ? "Saving…" : "Save as draft"}
      </Button>
      <Button variant="primary" onClick={onPublish} isDisabled={saving}>
        {saving ? "Publishing…" : "Publish now"}
      </Button>
    </WizardFooterWrapper>
  );
}

function OnboardAgentWizard({
  providers,
  mcpServers,
  skills,
  onDone,
  onCancel,
}: {
  providers: ProviderStatus[];
  mcpServers: McpServerStatus[];
  skills: Skill[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState<DepartmentId>("engineering");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("code");
  const [riskTier, setRiskTier] = useState<RiskTier>("medium");
  const [pricingUnit, setPricingUnit] = useState<PricingUnit>("per-task");
  const [pricingAmount, setPricingAmount] = useState("0.80");
  const [runtime, setRuntime] = useState<AgentRuntime>("generic-chat");
  const [openshellAgent, setOpenshellAgent] = useState("");
  const [engineOverride, setEngineOverride] = useState<"auto" | "simulated" | "live">("auto");
  const [providerId, setProviderId] = useState("");
  const [toolBindings, setToolBindings] = useState<{ serverId: string; tool: string }[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const connectedServers = mcpServers.filter((s) => s.connectionState === "connected");
  // engineType is an adapter-internal detail derived from the Runtime
  // choice — generic-chat listings are provisioned once via
  // deployments.ts, not per-Task, so their engineType is effectively
  // unused, but the field is still required on ListingCreateInput.
  const engineType: EngineType = runtime === "openshell" ? "self-hosted-sandbox" : "hosted-agent-api";
  // Mode is never picked independently — it's a strict 1:1 function of
  // engineType (see deriveAgentMode), which itself follows the Runtime
  // choice above. Shown read-only in step 1 so the relationship is visible.
  const mode = deriveAgentMode(engineType);

  function toggleTool(serverId: string, tool: string) {
    setToolBindings((prev) =>
      prev.some((b) => b.serverId === serverId && b.tool === tool)
        ? prev.filter((b) => !(b.serverId === serverId && b.tool === tool))
        : [...prev, { serverId, tool }]
    );
  }
  function toggleSkill(id: string) {
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function validateBasics(): string | null {
    if (!name.trim()) return "Name is required";
    if (!category.trim()) return "Category is required";
    if (!description.trim()) return "Description is required";
    return null;
  }

  function validateModes(): string | null {
    if (runtime === "openshell" && !openshellAgent.trim()) {
      return "OpenShell agent identifier is required for the OpenShell runtime";
    }
    return null;
  }

  async function submit(publish: boolean) {
    setSaving(true);
    setErr(null);
    try {
      await createListingAdmin({
        name: name.trim(),
        department,
        category: category.trim(),
        description: description.trim(),
        icon,
        engineType,
        riskTier,
        pricing: { unit: pricingUnit, amount: Number(pricingAmount) || 0 },
        runtime,
        openshellAgent: runtime === "openshell" ? openshellAgent.trim() : undefined,
        agentConfig: {
          providerId: providerId || undefined,
          engineOverride,
          skillIds,
          mcpToolBindings: toolBindings,
        },
        publish,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const previewListing: Listing = {
    id: "preview",
    name: name || "Untitled agent",
    department,
    category: category || "Uncategorized",
    description: description || "No description yet.",
    icon,
    engineType,
    runtime,
    mode,
    riskTier,
    reviewStatus: "draft",
    pricing: { unit: pricingUnit, amount: Number(pricingAmount) || 0 },
  };

  return (
    <Card>
      <CardBody>
        <Wizard
          onClose={onCancel}
          isVisitRequired
          header={
            <WizardHeader
              title="Onboard a new agent"
              description="Publish a new listing to the catalog, or save it as a draft to finish later."
              onClose={onCancel}
            />
          }
        >
          <WizardStep
            id="basics"
            name="Basics"
            footer={<WizardStepFooter onNext={() => { const e = validateBasics(); setErr(e); return e; }} onCancel={onCancel} />}
          >
            {err && <Alert variant="danger" isInline title={err} style={{ marginBottom: "1rem" }} />}
            <Form>
              <FormGroup label="Agent name" isRequired fieldId="wizard-name">
                <TextInput
                  id="wizard-name"
                  value={name}
                  onChange={(_e, v) => setName(v)}
                  placeholder="e.g. Contract summarizer"
                />
              </FormGroup>
              <FormGroup label="Department" isRequired fieldId="wizard-department">
                <FormSelect id="wizard-department" value={department} onChange={(_e, v) => setDepartment(v as DepartmentId)}>
                  {DEPARTMENTS.filter((d) => d.id !== "all").map((d) => (
                    <FormSelectOption key={d.id} value={d.id} label={d.name} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Category" isRequired fieldId="wizard-category">
                <TextInput
                  id="wizard-category"
                  value={category}
                  onChange={(_e, v) => setCategory(v)}
                  placeholder="e.g. Contract review"
                />
              </FormGroup>
              <FormGroup label="Icon" fieldId="wizard-icon">
                <FormSelect id="wizard-icon" value={icon} onChange={(_e, v) => setIcon(v)}>
                  {ICON_OPTIONS.map((i) => (
                    <FormSelectOption key={i.id} value={i.id} label={i.label} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Risk tier" fieldId="wizard-risk">
                <FormSelect id="wizard-risk" value={riskTier} onChange={(_e, v) => setRiskTier(v as RiskTier)}>
                  {RISK_TIERS.map((tier) => (
                    <FormSelectOption key={tier} value={tier} label={`${tier} risk`} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Price (USD)" fieldId="wizard-price">
                <TextInput id="wizard-price" inputMode="decimal" value={pricingAmount} onChange={(_e, v) => setPricingAmount(v)} />
              </FormGroup>
              <FormGroup label="Billed" fieldId="wizard-billed">
                <FormSelect id="wizard-billed" value={pricingUnit} onChange={(_e, v) => setPricingUnit(v as PricingUnit)}>
                  {PRICING_UNITS.map((u) => (
                    <FormSelectOption key={u.id} value={u.id} label={u.label} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Description" isRequired fieldId="wizard-description">
                <TextArea
                  id="wizard-description"
                  rows={3}
                  value={description}
                  onChange={(_e, v) => setDescription(v)}
                  placeholder="What does this agent do?"
                />
              </FormGroup>
            </Form>
          </WizardStep>

          <WizardStep
            id="modes"
            name="Modes & engine"
            footer={<WizardStepFooter onNext={() => { const e = validateModes(); setErr(e); return e; }} onCancel={onCancel} />}
          >
            {err && <Alert variant="danger" isInline title={err} style={{ marginBottom: "1rem" }} />}
            <Form>
              <FormGroup label="Runtime" fieldId="wizard-runtime">
                <FormSelect id="wizard-runtime" value={runtime} onChange={(_e, v) => setRuntime(v as AgentRuntime)}>
                  <FormSelectOption value="generic-chat" label="Generic chat agent (persistent Deployment + Route)" />
                  <FormSelectOption value="openshell" label="OpenShell (interactive coding/engineering sandbox)" />
                </FormSelect>
              </FormGroup>
              {runtime === "openshell" && (
                <FormGroup label="OpenShell agent identifier" isRequired fieldId="wizard-openshell-agent">
                  <TextInput
                    id="wizard-openshell-agent"
                    value={openshellAgent}
                    onChange={(_e, v) => setOpenshellAgent(v)}
                    placeholder="e.g. claude"
                  />
                </FormGroup>
              )}
              <FormGroup label="Engine" fieldId="wizard-engine">
                <FormSelect
                  id="wizard-engine"
                  value={engineOverride}
                  onChange={(_e, v) => setEngineOverride(v as "auto" | "simulated" | "live")}
                >
                  <FormSelectOption value="auto" label="Auto (use global engine setting)" />
                  <FormSelectOption value="simulated" label="Force simulated" />
                  <FormSelectOption value="live" label="Force live (AAP + OpenShift)" />
                </FormSelect>
              </FormGroup>
            </Form>
            <Content component={ContentVariants.small} style={{ marginTop: "1rem" }}>
              {runtime === "generic-chat"
                ? "Provisioned once via AAP as a persistent OpenShift Deployment + Route. Every user opens the same running agent from its web link — pick this for chat/support/SRE personas."
                : "Provisioned per-task as an OpenShell sandbox session — pick this for collaborative coding/engineering agents that need a live terminal."}
            </Content>
            <Content component={ContentVariants.small}>
              This will be listed as <strong>{modeLabel(mode)}</strong> — mode follows the runtime you
              picked above and isn&apos;t set independently.
            </Content>
          </WizardStep>

          <WizardStep id="model" name="Model & tools">
            <Form>
              <FormGroup label="Model provider" fieldId="wizard-provider">
                <FormSelect id="wizard-provider" value={providerId} onChange={(_e, v) => setProviderId(v)}>
                  <FormSelectOption value="" label="Use global active provider" />
                  {providers.map((p) => (
                    <FormSelectOption key={p.id} value={p.id} label={p.label} />
                  ))}
                </FormSelect>
              </FormGroup>
            </Form>
            {connectedServers.length === 0 ? (
              <Content component={ContentVariants.small} style={{ marginTop: "1rem" }}>
                No connected MCP servers yet — connect one in the MCP tab to bind
                tools now, or skip and bind later.
              </Content>
            ) : (
              <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "1rem" }}>
                {connectedServers.map((server) => (
                  <FlexItem key={server.id}>
                    <strong>{server.name}</strong>
                    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsXs" }}>
                      {server.tools.map((tool) => (
                        <FlexItem key={tool.name}>
                          <Checkbox
                            id={`wizard-tool-${server.id}-${tool.name}`}
                            label={tool.name}
                            isChecked={toolBindings.some((b) => b.serverId === server.id && b.tool === tool.name)}
                            onChange={() => toggleTool(server.id, tool.name)}
                          />
                        </FlexItem>
                      ))}
                    </Flex>
                  </FlexItem>
                ))}
              </Flex>
            )}
          </WizardStep>

          <WizardStep id="skills" name="Skills">
            {skills.length === 0 ? (
              <Content component={ContentVariants.small}>
                No skills authored yet — add one in the Skills tab, or skip and
                attach later.
              </Content>
            ) : (
              <SkillPicker skills={skills} selectedIds={skillIds} onToggle={toggleSkill} />
            )}
          </WizardStep>

          <WizardStep
            id="review"
            name="Review & publish"
            footer={
              <ReviewWizardStepFooter
                onCancel={onCancel}
                onSaveDraft={() => void submit(false)}
                onPublish={() => void submit(true)}
                saving={saving}
              />
            }
          >
            {err && <Alert variant="danger" isInline title={err} style={{ marginBottom: "1rem" }} />}
            <Content component={ContentVariants.small}>This is what users will see in the catalog:</Content>
            <div style={{ marginTop: "1rem", maxWidth: "22rem" }}>
              <ListingCard listing={previewListing} />
            </div>
          </WizardStep>
        </Wizard>
      </CardBody>
    </Card>
  );
}

type LLMsSubTab = "providers" | "mcp" | "openshell";

const LLMS_SUBTABS: { id: LLMsSubTab; label: string; icon: ComponentType }[] = [
  { id: "providers", label: "Providers", icon: PlugIcon },
  { id: "mcp", label: "MCP", icon: NetworkIcon },
  { id: "openshell", label: "OpenShell", icon: TerminalIcon },
];

function LLMsPanel() {
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
          one provider active. The active provider is used to generate real
          drafts for Autonomous-mode tasks, replacing the simulated text.
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
          Autonomous-mode drafting to be able to call.{" "}
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

// Display-only mirror of skillsImport.ts's RED_HAT_SKILL_PACKS — kept as a
// plain string list here (rather than importing the server module, which
// pulls in `fs`/`fetch`-to-GitHub code that has no place in a client
// bundle) so the panel can say which packs "Sync" will pull.
const RED_HAT_SKILL_PACK_LABELS = [
  "rh-basic",
  "rh-sre",
  "rh-developer",
  "rh-virt",
  "ocp-admin",
  "rh-ai-engineer",
  "rh-automation",
];

function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  // Only the "custom" group (if any custom skills exist) starts open, every
  // Red Hat pack starts collapsed — seeded once skills first load.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  function load() {
    fetchSkills()
      .then(setSkills)
      .catch((err: Error) => setError(err.message));
    fetchListings()
      .then(setListings)
      .catch(() => setListings([]));
  }

  useEffect(load, []);

  async function runImport() {
    setImporting(true);
    setImportMsg(null);
    try {
      const result = await importRedHatSkills();
      const failed = result.errors.length;
      const okPacks = result.packs.length - failed;
      setImportMsg(
        failed > 0
          ? `Imported ${result.written} skills from ${okPacks}/${result.packs.length} packs — ${failed} pack(s) failed (${result.errors.map((e) => e.pack).join(", ")}); check server logs.`
          : `Imported ${result.written} skills across ${result.packs.length} Red Hat packs.`
      );
      load();
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  // Which listings currently load each skill id, for the "used by" backlink
  // on each SkillRow — computed from the catalog, not stored on the skill.
  const usedByMap = useMemo(() => {
    const map = new Map<string, Listing[]>();
    for (const listing of listings) {
      for (const skillId of listing.agentConfig?.skillIds ?? []) {
        const list = map.get(skillId) ?? [];
        list.push(listing);
        map.set(skillId, list);
      }
    }
    return map;
  }, [listings]);

  useEffect(() => {
    if (seeded || !skills) return;
    setSeeded(true);
    if (skills.some((s) => s.source === "custom")) {
      setOpenGroups((prev) => new Set(prev).add("custom"));
    }
  }, [seeded, skills]);

  if (error) return <Alert variant="danger" isInline title={error} />;
  if (!skills) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading skills" />
      </Bullseye>
    );
  }

  const groups = groupSkillsByPack(skills);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const trimmedQuery = query.trim().toLowerCase();
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      skills: trimmedQuery
        ? group.skills.filter(
            (s) =>
              s.name.toLowerCase().includes(trimmedQuery) ||
              s.description.toLowerCase().includes(trimmedQuery)
          )
        : group.skills,
    }))
    .filter((group) => group.skills.length > 0);

  return (
    <Card>
      <CardTitle>Skills library</CardTitle>
      <CardBody>
        <Content component={ContentVariants.small}>
          Author reusable instruction bundles once, then attach one or more
          to any agent (from the Catalog tab or the onboarding wizard). A
          skill&apos;s instructions are merged into that agent&apos;s system
          prompt via progressive disclosure — the model sees a short menu and
          calls <code>load_skill</code> for the ones it needs. Red Hat pack
          skills below are imported and read-only; author your own with
          &quot;+ Add skill&quot;.
        </Content>

        <Card isCompact style={{ marginTop: "1rem" }}>
          <CardBody>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <strong>Sync Red Hat skill packs</strong>
                <Content component={ContentVariants.small}>
                  Pulls the latest {RED_HAT_SKILL_PACK_LABELS.join(", ")} packs from{" "}
                  <code>github.com/RHEcosystemAppEng/agentic-plugins</code> and refreshes
                  them below — no restart needed.
                </Content>
              </FlexItem>
              <FlexItem>
                <Button variant="secondary" onClick={runImport} isDisabled={importing}>
                  {importing ? "Syncing…" : "Sync now"}
                </Button>
              </FlexItem>
            </Flex>
            {importMsg && (
              <Content component={ContentVariants.small} style={{ marginTop: "0.5rem" }}>
                {importMsg}
              </Content>
            )}
          </CardBody>
        </Card>

        <div style={{ marginTop: "1rem" }}>
          <SearchInput
            aria-label="Search skills"
            placeholder={`Search ${skills.length} skills by name or description…`}
            value={query}
            onChange={(_e, v) => setQuery(v)}
            onClear={() => setQuery("")}
          />
        </div>

        {filteredGroups.length === 0 && (
          <Content component={ContentVariants.small}>No skills match &quot;{query}&quot;.</Content>
        )}

        <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "1rem" }}>
          {filteredGroups.map((group) => {
            const isOpen = trimmedQuery.length > 0 || openGroups.has(group.key);
            return (
              <FlexItem key={group.key}>
                <ExpandableSection
                  toggleContent={skillGroupToggle(group.label, `${group.skills.length}`)}
                  isExpanded={isOpen}
                  onToggle={() => toggleGroup(group.key)}
                >
                  <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
                    {group.skills.map((skill) => (
                      <FlexItem key={skill.id}>
                        <SkillRow skill={skill} usedBy={usedByMap.get(skill.id) ?? []} onChange={load} />
                      </FlexItem>
                    ))}
                  </Flex>
                </ExpandableSection>
              </FlexItem>
            );
          })}
        </Flex>

        <Button variant="secondary" style={{ marginTop: "1rem" }} onClick={() => setShowAdd(true)}>
          + Add skill
        </Button>

        {showAdd && (
          <AddSkillForm
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

function AddSkillForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !instructions.trim()) {
      setErr("Name and instructions are required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await upsertSkillConfig({
        id: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal variant="large" isOpen onClose={onCancel} aria-label="Add skill">
      <ModalHeader title="Add skill" />
      <ModalBody>
        <Form>
          {err && <Alert variant="danger" isInline title={err} />}
          <FormGroup label="Name" isRequired fieldId="add-skill-name">
            <TextInput
              id="add-skill-name"
              placeholder="Name, e.g. Billing tone guide"
              value={name}
              onChange={(_e, v) => setName(v)}
            />
          </FormGroup>
          <FormGroup label="Description" fieldId="add-skill-description">
            <TextInput
              id="add-skill-description"
              placeholder="Short description (optional)"
              value={description}
              onChange={(_e, v) => setDescription(v)}
            />
          </FormGroup>
          <FormGroup label="Instructions" isRequired fieldId="add-skill-instructions">
            <TextArea
              id="add-skill-instructions"
              rows={8}
              placeholder="Instructions to merge into the agent's system prompt…"
              value={instructions}
              onChange={(_e, v) => setInstructions(v)}
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={() => void save()} isDisabled={saving}>
          {saving ? "Adding…" : "Add skill"}
        </Button>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function SkillRow({
  skill,
  usedBy,
  onChange,
}: {
  skill: Skill;
  usedBy: Listing[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showUsedBy, setShowUsedBy] = useState(false);
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [instructions, setInstructions] = useState(skill.instructions);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await upsertSkillConfig({ id: skill.id, name, description, instructions });
      setEditing(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteSkillConfig(skill.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const isBuiltin = skill.source === "built-in";

  return (
    <Card isCompact>
      <CardBody>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsFlexStart" }}>
          <FlexItem>
            <strong>{skill.name}</strong>{" "}
            {skill.pack && (
              <Label isCompact color="grey">
                {skill.pack}
              </Label>
            )}
            {skill.description && <Content component={ContentVariants.small}>{skill.description}</Content>}
          </FlexItem>
          <FlexItem>
            <Flex spaceItems={{ default: "spaceItemsSm" }}>
              <FlexItem>
                <Button
                  variant="link"
                  isInline
                  onClick={() => setShowUsedBy((v) => !v)}
                  isDisabled={usedBy.length === 0}
                  title={usedBy.length === 0 ? "Not attached to any listing yet" : "Show which listings use this skill"}
                >
                  Used by {usedBy.length} listing{usedBy.length === 1 ? "" : "s"}
                </Button>
              </FlexItem>
              {isBuiltin ? (
                <FlexItem>
                  <Label isCompact color="grey">
                    Built-in (read-only)
                  </Label>
                </FlexItem>
              ) : (
                <>
                  <FlexItem>
                    <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
                      {editing ? "Close" : "Edit"}
                    </Button>
                  </FlexItem>
                  <FlexItem>
                    <Button variant="danger" onClick={remove} isDisabled={busy}>
                      Remove
                    </Button>
                  </FlexItem>
                </>
              )}
            </Flex>
          </FlexItem>
        </Flex>

        {showUsedBy && usedBy.length > 0 && (
          <ul style={{ marginTop: "0.5rem" }}>
            {usedBy.map((listing) => (
              <li key={listing.id}>{listing.name}</li>
            ))}
          </ul>
        )}

        {!isBuiltin && editing ? (
          <Form style={{ marginTop: "0.75rem" }}>
            <Flex spaceItems={{ default: "spaceItemsMd" }}>
              <FlexItem flex={{ default: "flex_1" }}>
                <FormGroup label="Name" fieldId={`skill-${skill.id}-name`}>
                  <TextInput id={`skill-${skill.id}-name`} value={name} onChange={(_e, v) => setName(v)} />
                </FormGroup>
              </FlexItem>
              <FlexItem flex={{ default: "flex_1" }}>
                <FormGroup label="Description" fieldId={`skill-${skill.id}-description`}>
                  <TextInput
                    id={`skill-${skill.id}-description`}
                    value={description}
                    onChange={(_e, v) => setDescription(v)}
                  />
                </FormGroup>
              </FlexItem>
            </Flex>
            <FormGroup label="Instructions" fieldId={`skill-${skill.id}-instructions`}>
              <TextArea
                id={`skill-${skill.id}-instructions`}
                rows={4}
                value={instructions}
                onChange={(_e, v) => setInstructions(v)}
              />
            </FormGroup>
            <Button variant="primary" onClick={() => void save()} isDisabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </Form>
        ) : (
          <div style={{ marginTop: "0.5rem" }}>
            <Button variant="link" isInline onClick={() => setShowInstructions((v) => !v)}>
              {showInstructions ? "Hide instructions" : "Show instructions"}
            </Button>
            {showInstructions && <Markdown>{skill.instructions}</Markdown>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AuditLog() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetchTasks()
        .then(setTasks)
        .catch((err: Error) => setError(err.message));
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <Alert variant="danger" isInline title={error} />;
  if (!tasks) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading tasks" />
      </Bullseye>
    );
  }
  if (tasks.length === 0) {
    return <Content component={ContentVariants.small}>No tasks have been launched yet.</Content>;
  }

  return (
    <Table aria-label="Tasks and usage">
      <Thead>
        <Tr>
          <Th>Listing</Th>
          <Th>Department</Th>
          <Th>Mode</Th>
          <Th>Phase</Th>
          <Th>Engine</Th>
          <Th>Cost</Th>
        </Tr>
      </Thead>
      <Tbody>
        {tasks.map((task) => (
          <Tr key={task.id}>
            <Td dataLabel="Listing">
              <strong>{task.listingName}</strong>
            </Td>
            <Td dataLabel="Department">{departmentLabel(task.department)}</Td>
            <Td dataLabel="Mode">{modeLabel(task.mode)}</Td>
            <Td dataLabel="Phase">
              <PhaseLabel phase={task.status.phase} />
            </Td>
            <Td dataLabel="Engine">{task.status.live ? "Live" : "Simulated"}</Td>
            <Td dataLabel="Cost">{formatUsd(task.status.costEstimate ?? 0)}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
