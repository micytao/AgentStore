"use client";

import { useEffect, useMemo, useState } from "react";
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
  SearchInput,
  Spinner,
  TextArea,
  TextInput,
  Title,
  Wizard,
  WizardFooterWrapper,
  WizardHeader,
  WizardStep,
  useWizardContext,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import {
  DEPARTMENTS,
  departmentLabel,
  type AgentRuntime,
  type DepartmentId,
  type Listing,
  type ListingUpdate,
  type McpServerStatus,
  type Pricing,
  type PricingUnit,
  type ProviderStatus,
  type ReviewStatus,
  type RiskTier,
  type Skill,
} from "@agentstore/shared";
import { LiveTerminal } from "@/components/LiveTerminal";
import {
  createListingAdmin,
  deleteListingAdmin,
  deployListingAdmin,
  fetchDeploymentStatus,
  fetchListings,
  fetchMcpServers,
  fetchOpenShellSessionStatus,
  fetchProviders,
  fetchSkills,
  startOpenShellSession,
  stopDeploymentAdmin,
  stopOpenShellSession,
  updateListingAdmin,
} from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { groupSkillsByPack, skillGroupToggle } from "@/lib/skillGrouping";

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

export function CatalogManager() {
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

  // Self-heals any listing whose deployment/session status is stuck at
  // "deploying" even when nobody currently has that listing's "Agent
  // config" panel expanded — DeploySection/OpenShellDeploySection only
  // poll for completion while actually mounted, so a deploy that
  // finishes after an admin collapses the panel (or never opens it
  // again) would otherwise leave the persisted status stuck at
  // "deploying" forever: no routeUrl, no "Open agent" button, a
  // permanently-grey status label, even though the real Deployment on
  // OpenShift finished successfully. This runs unconditionally at the
  // table level instead, independent of which rows are expanded.
  useEffect(() => {
    if (!listings) return;
    const pendingGenericChat = listings.filter(
      (l) => l.runtime !== "openshell" && l.deployment?.status === "deploying"
    );
    const pendingOpenshell = listings.filter(
      (l) => l.runtime === "openshell" && l.openshellSession?.status === "deploying"
    );
    if (pendingGenericChat.length === 0 && pendingOpenshell.length === 0) return;

    const timer = setInterval(() => {
      Promise.all([
        ...pendingGenericChat.map((l) => fetchDeploymentStatus(l.id).catch(() => null)),
        ...pendingOpenshell.map((l) => fetchOpenShellSessionStatus(l.id).catch(() => null)),
      ]).then((results) => {
        const byId = new Map(
          results.filter((l): l is Listing => Boolean(l)).map((l) => [l.id, l])
        );
        if (byId.size === 0) return;
        setListings((prev) => prev?.map((l) => byId.get(l.id) ?? l) ?? prev);
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [listings]);

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
          save immediately. Open Agent config to bind a provider, tools,
          skills, and the AAP job template, or delete the agent entirely.
        </Content>
      </FlexItem>

      <FlexItem>
        <Card>
          <CardBody>
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
          </CardBody>
        </Card>
      </FlexItem>

      <FlexItem>
        <Button variant="primary" onClick={() => setShowWizard(true)}>
          + Onboard new agent
        </Button>
        {showWizard && (
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
    if (
      !window.confirm(
        `Delete "${listing.name}"? It disappears from the catalog immediately and any running deployment/session is torn down.`
      )
    )
      return;
    setDeleting(true);
    try {
      const { warning } = await deleteListingAdmin(listing.id);
      if (warning) window.alert(warning);
      onChange();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Tbody>
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
              {listing.runtime === "openshell" && listing.openshellSession?.status === "running" ? (
                <FlexItem>
                  <Button variant="primary" size="sm" onClick={() => setShowConfig(true)}>
                    Open terminal
                  </Button>
                </FlexItem>
              ) : listing.runtime !== "openshell" &&
                listing.deployment?.status === "running" &&
                listing.deployment.routeUrl ? (
                <FlexItem>
                  <Button
                    variant="primary"
                    size="sm"
                    component={(props) => (
                      <a {...props} href={listing.deployment!.routeUrl} target="_blank" rel="noreferrer" />
                    )}
                  >
                    Open agent
                  </Button>
                </FlexItem>
              ) : null}
              <FlexItem>
                <Button variant={saved ? "secondary" : "primary"} size="sm" onClick={() => void save()} isDisabled={saving}>
                  {saving ? "Saving…" : saved ? "Saved" : "Save"}
                </Button>
              </FlexItem>
              <FlexItem>
                <Button variant="secondary" size="sm" onClick={() => setShowConfig(true)}>
                  Agent config
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
      </Tbody>
      {showConfig && (
        <Modal
          variant="large"
          isOpen
          onClose={() => setShowConfig(false)}
          aria-label={`Agent config — ${listing.name}`}
        >
          <ModalHeader title={`Agent config — ${listing.name}`} />
          <ModalBody>
            <AgentConfigPanel
              listing={listing}
              providers={providers}
              mcpServers={mcpServers}
              skills={skills}
              onChange={onChange}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="link" onClick={() => setShowConfig(false)}>
              Close
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
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
  const [skillIds, setSkillIds] = useState<string[]>(listing.agentConfig?.skillIds ?? []);
  const [toolBindings, setToolBindings] = useState<{ serverId: string; tool: string }[]>(
    listing.agentConfig?.mcpToolBindings ?? []
  );
  const [aapJobTemplateId, setAapJobTemplateId] = useState(
    listing.agentConfig?.aapJobTemplateId ? String(listing.agentConfig.aapJobTemplateId) : ""
  );
  const [gitUrl, setGitUrl] = useState(listing.agentConfig?.gitUrl ?? "");
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
          skillIds,
          mcpToolBindings: toolBindings,
          aapJobTemplateId: aapJobTemplateId.trim()
            ? Number(aapJobTemplateId)
            : undefined,
          gitUrl: gitUrl.trim() || undefined,
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
        <Content component={ContentVariants.small}>
          Bind a specific model provider, tool subset, and skills to this
          agent. Leave provider unset to keep using the global active
          provider.
          {listing.runtime === "generic-chat" && (
            <>
              {" "}The AAP job template below (leave unset for the Platform
              default) must launch <code>provision-generic-agent.yml</code>.
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
            {listing.runtime === "generic-chat" ? (
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
            ) : (
              <FlexItem flex={{ default: "flex_1" }}>
                <FormGroup label="Repository URL" fieldId="agent-config-git-url">
                  <TextInput
                    id="agent-config-git-url"
                    placeholder="https://github.com/example/billing-service"
                    value={gitUrl}
                    onChange={(_e, v) => {
                      setGitUrl(v);
                      setSaved(false);
                    }}
                  />
                </FormGroup>
              </FlexItem>
            )}
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

      {listing.runtime === "openshell" && (
        <FlexItem>
          <OpenShellDeploySection listing={listing} onChange={onChange} />
        </FlexItem>
      )}
    </Flex>
  );
}

/** "Deploy to OpenShift" action for a generic-chat listing: launches (or
 * re-launches) provision-generic-agent.yml via AAP and polls GET .../deploy
 * while in flight. A one-time, per-listing action — every admin who opens
 * this listing afterwards just clicks "Open agent" on the same running
 * deployment, instead of anything being provisioned per-visit. */
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

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      const updated = await stopDeploymentAdmin(listing.id);
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
              <Flex alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsMd" }}>
                {deployment?.aapJobUrl && (
                  <FlexItem>
                    <Content component={ContentVariants.small}>
                      <a href={deployment.aapJobUrl} target="_blank" rel="noreferrer">
                        View AAP job →
                      </a>
                    </Content>
                  </FlexItem>
                )}
                {status === "running" && deployment?.routeUrl && (
                  <FlexItem>
                    <Button
                      variant="danger"
                      component={(props) => (
                        <a {...props} href={deployment.routeUrl} target="_blank" rel="noreferrer" />
                      )}
                    >
                      Open agent →
                    </Button>
                  </FlexItem>
                )}
              </Flex>
            </FlexItem>
          )}

          <FlexItem>
            <Flex spaceItems={{ default: "spaceItemsSm" }}>
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
              {(status === "running" || status === "failed") && (
                <FlexItem>
                  <Button variant="danger" onClick={() => void stop()} isDisabled={busy}>
                    Stop
                  </Button>
                </FlexItem>
              )}
            </Flex>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
}

/** "Deploy" action for an openshell listing: creates (or re-creates) this
 * listing's persistent Agent Sandbox Service session — the collaborative-
 * agent equivalent of DeploySection above. A one-time, per-listing action;
 * every admin who reopens this listing afterwards just clicks "Open
 * terminal" against the same running sandbox instead of a fresh one being
 * provisioned per visit. */
function OpenShellDeploySection({ listing, onChange }: { listing: Listing; onChange: () => void }) {
  const [session, setSession] = useState(listing.openshellSession);
  const [busy, setBusy] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(listing.openshellSession);
  }, [listing.openshellSession]);

  useEffect(() => {
    if (session?.status !== "deploying") return;
    const timer = setInterval(() => {
      fetchOpenShellSessionStatus(listing.id)
        .then((next) => {
          setSession(next.openshellSession);
          if (next.openshellSession?.status !== "deploying") onChange();
        })
        .catch((err: Error) => setError(err.message));
    }, 3000);
    return () => clearInterval(timer);
  }, [session?.status, listing.id, onChange]);

  async function deploy() {
    setBusy(true);
    setError(null);
    setShowTerminal(false);
    try {
      const updated = await startOpenShellSession(listing.id);
      setSession(updated.openshellSession);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError(null);
    setShowTerminal(false);
    try {
      const updated = await stopOpenShellSession(listing.id);
      setSession(updated.openshellSession);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const status = session?.status ?? "not-deployed";
  const statusColor: "green" | "red" | "grey" = status === "running" ? "green" : status === "failed" ? "red" : "grey";

  return (
    <Card isCompact>
      <CardTitle>Deploy sandbox session</CardTitle>
      <CardBody>
        <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
          <FlexItem>
            <Content component={ContentVariants.small}>
              OpenShell agents are provisioned once: a persistent Agent Sandbox
              Service session is created for this listing, and every admin
              opens the same live terminal against it — no per-visit
              provisioning.
            </Content>
          </FlexItem>

          {error && (
            <FlexItem>
              <Alert variant="danger" isInline title={error} />
            </FlexItem>
          )}
          {session?.error && (
            <FlexItem>
              <Alert variant="danger" isInline title={session.error} />
            </FlexItem>
          )}

          <FlexItem>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <strong>Status</strong>
                <Content component={ContentVariants.small}>
                  {session?.updatedAt ? `Updated ${new Date(session.updatedAt).toLocaleString()}` : "Never deployed"}
                </Content>
              </FlexItem>
              <FlexItem>
                <Label color={statusColor} isCompact>
                  {status}
                </Label>
              </FlexItem>
            </Flex>
          </FlexItem>

          <FlexItem>
            <Flex spaceItems={{ default: "spaceItemsSm" }}>
              <FlexItem>
                <Button variant="primary" onClick={() => void deploy()} isDisabled={busy || status === "deploying"}>
                  {busy
                    ? "Starting…"
                    : status === "deploying"
                      ? "Deploying…"
                      : status === "running"
                        ? "Redeploy"
                        : "Deploy"}
                </Button>
              </FlexItem>
              {status === "running" && (
                <>
                  <FlexItem>
                    <Button variant="secondary" onClick={() => setShowTerminal((v) => !v)}>
                      {showTerminal ? "Hide terminal" : "Open terminal"}
                    </Button>
                  </FlexItem>
                  <FlexItem>
                    <Button variant="danger" onClick={() => void stop()} isDisabled={busy}>
                      Stop
                    </Button>
                  </FlexItem>
                </>
              )}
            </Flex>
          </FlexItem>

          {showTerminal && status === "running" && (
            <FlexItem>
              <LiveTerminal listingId={listing.id} listingName={listing.name} />
            </FlexItem>
          )}
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
  const [gitUrl, setGitUrl] = useState("");
  const [providerId, setProviderId] = useState("");
  const [toolBindings, setToolBindings] = useState<{ serverId: string; tool: string }[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const connectedServers = mcpServers.filter((s) => s.connectionState === "connected");

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
        riskTier,
        pricing: { unit: pricingUnit, amount: Number(pricingAmount) || 0 },
        runtime,
        openshellAgent: runtime === "openshell" ? openshellAgent.trim() : undefined,
        agentConfig: {
          providerId: providerId || undefined,
          skillIds,
          mcpToolBindings: toolBindings,
          gitUrl: runtime === "openshell" ? gitUrl.trim() || undefined : undefined,
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

  return (
    // `onEscapePress` (not `onClose`) on purpose: passing `onClose` makes
    // Modal render its own close X, which then visually collides with
    // WizardHeader's own close X (different padding/z-index assumptions —
    // Modal's close button is positioned assuming a plain ModalHeader
    // sibling, not a Wizard header banner). WizardHeader's own X is the
    // only close affordance; this just keeps Escape working.
    <Modal variant="large" isOpen onEscapePress={onCancel} aria-label="Onboard a new agent">
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
                <>
                  <FormGroup label="OpenShell agent identifier" isRequired fieldId="wizard-openshell-agent">
                    <TextInput
                      id="wizard-openshell-agent"
                      value={openshellAgent}
                      onChange={(_e, v) => setOpenshellAgent(v)}
                      placeholder="e.g. claude"
                    />
                  </FormGroup>
                  <FormGroup label="Repository URL" fieldId="wizard-git-url">
                    <TextInput
                      id="wizard-git-url"
                      value={gitUrl}
                      onChange={(_e, v) => setGitUrl(v)}
                      placeholder="https://github.com/example/billing-service"
                    />
                  </FormGroup>
                </>
              )}
            </Form>
            <Content component={ContentVariants.small} style={{ marginTop: "1rem" }}>
              {runtime === "generic-chat"
                ? "Provisioned once as a persistent OpenShift Deployment + Route. Every admin opens the same running agent from its web link — pick this for autonomous chat/support/SRE agents."
                : "Provisioned once as a persistent Agent Sandbox Service session with a live terminal — pick this for collaborative coding/engineering agents you'll log into like a CLI."}
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
            <Content component={ContentVariants.small}>Review before publishing:</Content>
            <Card isCompact style={{ marginTop: "1rem", maxWidth: "26rem" }}>
              <CardTitle>{name || "Untitled agent"}</CardTitle>
              <CardBody>
                <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsXs" }}>
                  <FlexItem>
                    <Content component={ContentVariants.small}>
                      {departmentLabel(department)} · {category || "Uncategorized"}
                    </Content>
                  </FlexItem>
                  <FlexItem>{description || "No description yet."}</FlexItem>
                  <FlexItem>
                    <Label isCompact>{runtime === "generic-chat" ? "Generic chat" : "OpenShell"}</Label>{" "}
                    <Label isCompact color={riskTier === "high" ? "red" : riskTier === "medium" ? "orange" : "green"}>
                      {riskTier} risk
                    </Label>
                  </FlexItem>
                  <FlexItem>
                    {formatUsd(Number(pricingAmount) || 0)} {PRICING_UNITS.find((u) => u.id === pricingUnit)?.label}
                  </FlexItem>
                </Flex>
              </CardBody>
            </Card>
          </WizardStep>
      </Wizard>
    </Modal>
  );
}
