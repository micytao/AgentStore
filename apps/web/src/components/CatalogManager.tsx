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
  Gallery,
  GalleryItem,
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
  ToggleGroup,
  ToggleGroupItem,
  Wizard,
  WizardFooterWrapper,
  WizardHeader,
  WizardStep,
  useWizardContext,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import {
  DEPARTMENTS,
  OPENSHELL_AGENTS,
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

/** Suggested (not exhaustive) category values for the onboarding wizard,
 * scoped *within* each Department rather than restating it. Department is
 * "who owns/runs this" (org structure); Category is "which specific job
 * within that department" (a drill-down, not a synonym) — e.g. Engineering
 * splits into Software development / Site reliability / Virtualization /
 * Platform & DevOps, mirroring how the built-in catalog's real categories
 * (Software development, Site reliability, Virtualization) already work.
 * Keeping this per-department (instead of one flat list) is what avoids
 * categories that just re-spell the department name. */
const CATEGORY_OPTIONS_BY_DEPARTMENT: Record<DepartmentId, string[]> = {
  engineering: ["Software development", "Site reliability", "Virtualization", "Platform & DevOps"],
  support: ["Customer support", "Technical support", "Onboarding & training", "IT helpdesk"],
  security: ["Compliance auditing", "Vulnerability management", "Access review", "Threat detection"],
  data: ["Analytics & reporting", "Data engineering", "BI & dashboards"],
  finance: ["Expense management", "Payroll & HR ops", "Procurement", "Cost optimization"],
};

export function CatalogManager() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "badge">("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<DepartmentId | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

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

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of listings ?? []) {
      if (l.category) set.add(l.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [listings]);

  const filteredListings = useMemo(() => {
    if (!listings) return null;
    const query = searchQuery.trim().toLowerCase();
    return listings.filter((l) => {
      if (departmentFilter !== "all" && l.department !== departmentFilter) return false;
      if (categoryFilter !== "all" && l.category !== categoryFilter) return false;
      if (
        query &&
        !l.name.toLowerCase().includes(query) &&
        !l.description.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
  }, [listings, searchQuery, departmentFilter, categoryFilter]);

  if (error) return <Alert variant="danger" isInline title={error} />;
  if (!listings) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading catalog" />
      </Bullseye>
    );
  }
  const visibleListings = filteredListings ?? [];

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
        <Flex
          spaceItems={{ default: "spaceItemsMd" }}
          alignItems={{ default: "alignItemsFlexEnd" }}
          flexWrap={{ default: "wrap" }}
        >
          <FlexItem flex={{ default: "flex_1" }} style={{ minWidth: "16rem" }}>
            <SearchInput
              aria-label="Search listings"
              placeholder="Search by name or description…"
              value={searchQuery}
              onChange={(_e, v) => setSearchQuery(v)}
              onClear={() => setSearchQuery("")}
            />
          </FlexItem>
          <FlexItem>
            <FormSelect
              aria-label="Filter by department"
              value={departmentFilter}
              onChange={(_e, v) => setDepartmentFilter(v as DepartmentId | "all")}
            >
              {DEPARTMENTS.map((d) => (
                <FormSelectOption key={d.id} value={d.id} label={d.name} />
              ))}
            </FormSelect>
          </FlexItem>
          <FlexItem>
            <FormSelect
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(_e, v) => setCategoryFilter(v)}
            >
              <FormSelectOption value="all" label="All categories" />
              {categoryOptions.map((c) => (
                <FormSelectOption key={c} value={c} label={c} />
              ))}
            </FormSelect>
          </FlexItem>
          {(searchQuery || departmentFilter !== "all" || categoryFilter !== "all") && (
            <FlexItem>
              <Button
                variant="link"
                onClick={() => {
                  setSearchQuery("");
                  setDepartmentFilter("all");
                  setCategoryFilter("all");
                }}
              >
                Clear filters
              </Button>
            </FlexItem>
          )}
          <FlexItem align={{ default: "alignRight" }}>
            <ToggleGroup aria-label="Catalog view">
              <ToggleGroupItem
                text="Table"
                isSelected={viewMode === "table"}
                onChange={() => setViewMode("table")}
              />
              <ToggleGroupItem
                text="Badge"
                isSelected={viewMode === "badge"}
                onChange={() => setViewMode("badge")}
              />
            </ToggleGroup>
          </FlexItem>
        </Flex>
      </FlexItem>

      <FlexItem>
        {visibleListings.length === 0 ? (
          <Card>
            <CardBody>
              <Content component={ContentVariants.small}>
                No listings match the current search/filters.
              </Content>
            </CardBody>
          </Card>
        ) : viewMode === "table" ? (
          <Card>
            <CardBody>
              {/* isExpandable here is purely a styling flag (adds the
                  pf-m-expandable class) — it's what makes isStriped target
                  every-other <Tbody> instead of every-other <Tr>, which is
                  what we need since each listing row is its own <Tbody>. */}
              <Table aria-label="Catalog listings" isStriped isExpandable>
                <Thead>
                  <Tr>
                    <Th modifier="nowrap">Listing</Th>
                    <Th modifier="nowrap">Risk tier</Th>
                    <Th modifier="nowrap">Review status</Th>
                    <Th modifier="nowrap">Price</Th>
                    <Th screenReaderText="Actions" />
                  </Tr>
                </Thead>
                {visibleListings.map((listing) => (
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
        ) : (
          <Gallery hasGutter minWidths={{ default: "22rem" }}>
            {visibleListings.map((listing) => (
              <ListingBadgeCard
                key={listing.id}
                listing={listing}
                providers={providers}
                mcpServers={mcpServers}
                skills={skills}
                onChange={loadAll}
              />
            ))}
          </Gallery>
        )}
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

/** Shared editable-row state for a listing — draft fields (risk tier,
 * review status, price), save/delete handlers, and the "Agent config"
 * modal's open flag. Used by both `ListingRow` (table view) and
 * `ListingBadgeCard` (badge view) so the two presentations can never
 * drift out of sync with each other's editing/saving/deleting behavior. */
function useListingRowState(listing: Listing, onChange: () => void) {
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
  const [showTerminal, setShowTerminal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null);

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

  // Delete is a two-step flow through DeleteConfirmModal (an in-app Modal)
  // instead of window.confirm/window.alert, so it matches the rest of the
  // UI instead of popping up the browser's own native dialog chrome.
  function requestDelete() {
    setConfirmDeleteOpen(true);
  }

  function cancelDelete() {
    setConfirmDeleteOpen(false);
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      const { warning } = await deleteListingAdmin(listing.id);
      setConfirmDeleteOpen(false);
      onChange();
      if (warning) setDeleteWarning(warning);
    } finally {
      setDeleting(false);
    }
  }

  function dismissDeleteWarning() {
    setDeleteWarning(null);
  }

  return {
    draft,
    update,
    save,
    saving,
    saved,
    showConfig,
    setShowConfig,
    showTerminal,
    setShowTerminal,
    deleting,
    confirmDeleteOpen,
    requestDelete,
    cancelDelete,
    confirmDelete,
    deleteWarning,
    dismissDeleteWarning,
  };
}

/** Shared action buttons (Open agent/terminal, Save, Agent config,
 * Delete) — identical set for both the table row and the badge card. */
function ListingActionsBar({
  listing,
  saving,
  saved,
  deleting,
  onSave,
  onDelete,
  onOpenConfig,
  onOpenTerminal,
}: {
  listing: Listing;
  saving: boolean;
  saved: boolean;
  deleting: boolean;
  onSave: () => void;
  onDelete: () => void;
  onOpenConfig: () => void;
  onOpenTerminal: () => void;
}) {
  return (
    <Flex
      spaceItems={{ default: "spaceItemsXs" }}
      flexWrap={{ default: "nowrap" }}
      justifyContent={{ default: "justifyContentFlexEnd" }}
    >
      {listing.runtime === "openshell" && listing.openshellSession?.status === "running" ? (
        <FlexItem>
          <Button variant="primary" size="sm" onClick={onOpenTerminal}>
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
        <Button variant={saved ? "secondary" : "primary"} size="sm" onClick={onSave} isDisabled={saving}>
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </FlexItem>
      <FlexItem>
        <Button variant="secondary" size="sm" onClick={onOpenConfig}>
          Config
        </Button>
      </FlexItem>
      <FlexItem>
        <Button variant="danger" size="sm" onClick={onDelete} isDisabled={deleting}>
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      </FlexItem>
    </Flex>
  );
}

/** Shared "Agent config" modal — identical for both views. Always safe to
 * mount unconditionally; renders nothing while `isOpen` is false. */
function ListingConfigModal({
  listing,
  providers,
  mcpServers,
  skills,
  isOpen,
  onClose,
  onChange,
}: {
  listing: Listing;
  providers: ProviderStatus[];
  mcpServers: McpServerStatus[];
  skills: Skill[];
  isOpen: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  if (!isOpen) return null;
  return (
    <Modal variant="large" isOpen onClose={onClose} aria-label={`Agent config — ${listing.name}`}>
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
        <Button variant="link" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** Shared delete confirmation — an in-app Modal instead of
 * window.confirm/window.alert, so it looks and behaves like the rest of
 * the UI. Doubles as the post-delete warning dialog: if the teardown of
 * live infra (deployment/OpenShell session) only partially succeeds,
 * `warning` is set and this same Modal switches from "confirm?" to
 * "here's what happened" instead of stacking a second dialog. */
function DeleteConfirmModal({
  listing,
  isOpen,
  deleting,
  warning,
  onCancel,
  onConfirm,
  onDismissWarning,
}: {
  listing: Listing;
  isOpen: boolean;
  deleting: boolean;
  warning: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onDismissWarning: () => void;
}) {
  if (!isOpen && !warning) return null;

  if (warning) {
    return (
      <Modal variant="small" isOpen onClose={onDismissWarning} aria-label={`Delete warning — ${listing.name}`}>
        <ModalHeader title={`"${listing.name}" was deleted`} />
        <ModalBody>
          <Alert variant="warning" isInline title="Removed from the catalog, but with a problem tearing down its live infrastructure">
            {warning}
          </Alert>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={onDismissWarning}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal variant="small" isOpen onClose={onCancel} aria-label={`Delete ${listing.name}`}>
      <ModalHeader title={`Delete "${listing.name}"?`} titleIconVariant="warning" />
      <ModalBody>
        It disappears from the catalog immediately, and any running deployment or OpenShell session for it is torn down.
      </ModalBody>
      <ModalFooter>
        <Button variant="danger" isLoading={deleting} isDisabled={deleting} onClick={onConfirm}>
          Delete
        </Button>
        <Button variant="link" onClick={onCancel} isDisabled={deleting}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function riskLabelColor(tier: RiskTier): "red" | "orange" | "green" {
  return tier === "high" ? "red" : tier === "medium" ? "orange" : "green";
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
  const {
    draft,
    update,
    save,
    saving,
    saved,
    showConfig,
    setShowConfig,
    showTerminal,
    setShowTerminal,
    deleting,
    confirmDeleteOpen,
    requestDelete,
    cancelDelete,
    confirmDelete,
    deleteWarning,
    dismissDeleteWarning,
  } = useListingRowState(listing, onChange);

  return (
    <>
      <Tbody>
        <Tr>
          <Td dataLabel="Listing">
            <strong>{listing.name}</strong>
            <br />
            <Content component={ContentVariants.small}>
              {departmentLabel(listing.department)}
              {listing.category ? ` · ${listing.category}` : ""}
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
          <Td dataLabel="Actions">
            <ListingActionsBar
              listing={listing}
              saving={saving}
              saved={saved}
              deleting={deleting}
              onSave={() => void save()}
              onDelete={requestDelete}
              onOpenConfig={() => setShowConfig(true)}
              onOpenTerminal={() => setShowTerminal(true)}
            />
          </Td>
        </Tr>
      </Tbody>
      {showTerminal && listing.runtime === "openshell" && (
        <LiveTerminal listingId={listing.id} listingName={listing.name} onClose={() => setShowTerminal(false)} />
      )}
      <ListingConfigModal
        listing={listing}
        providers={providers}
        mcpServers={mcpServers}
        skills={skills}
        isOpen={showConfig}
        onClose={() => setShowConfig(false)}
        onChange={onChange}
      />
      <DeleteConfirmModal
        listing={listing}
        isOpen={confirmDeleteOpen}
        deleting={deleting}
        warning={deleteWarning}
        onCancel={cancelDelete}
        onConfirm={() => void confirmDelete()}
        onDismissWarning={dismissDeleteWarning}
      />
    </>
  );
}

/** Badge/card presentation of the same listing row — same editable
 * fields, actions, and Agent config modal as `ListingRow`, laid out as a
 * `Card` for the Gallery grid instead of table cells. */
function ListingBadgeCard({
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
  const {
    draft,
    update,
    save,
    saving,
    saved,
    showConfig,
    setShowConfig,
    showTerminal,
    setShowTerminal,
    deleting,
    confirmDeleteOpen,
    requestDelete,
    cancelDelete,
    confirmDelete,
    deleteWarning,
    dismissDeleteWarning,
  } = useListingRowState(listing, onChange);

  return (
    <>
      <GalleryItem>
        <Card isFullHeight isCompact>
          <CardTitle>{listing.name}</CardTitle>
          <CardBody>
            <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
              <FlexItem>
                <Content component={ContentVariants.small}>
                  {departmentLabel(listing.department)}
                  {listing.category ? ` · ${listing.category}` : ""}
                  {listing.source === "custom" ? " · Custom" : ""}
                </Content>
              </FlexItem>
              <FlexItem>
                <Flex spaceItems={{ default: "spaceItemsXs" }} flexWrap={{ default: "wrap" }}>
                  <FlexItem>
                    <Label color={riskLabelColor(draft.riskTier)} isCompact>
                      {draft.riskTier} risk
                    </Label>
                  </FlexItem>
                  <FlexItem>
                    <Label isCompact>{draft.reviewStatus}</Label>
                  </FlexItem>
                  <FlexItem>
                    <Label isCompact>
                      {formatUsd(draft.pricing.amount)}
                      {draft.pricing.unit === "per-hour" ? " / hour" : " / task"}
                    </Label>
                  </FlexItem>
                </Flex>
              </FlexItem>
              <FlexItem>
                <Flex spaceItems={{ default: "spaceItemsSm" }} flexWrap={{ default: "wrap" }}>
                  <FlexItem style={{ minWidth: "7rem" }}>
                    <FormSelect
                      aria-label={`Risk tier for ${listing.name}`}
                      value={draft.riskTier}
                      onChange={(_e, v) => update({ riskTier: v as RiskTier })}
                    >
                      {RISK_TIERS.map((tier) => (
                        <FormSelectOption key={tier} value={tier} label={tier} />
                      ))}
                    </FormSelect>
                  </FlexItem>
                  <FlexItem style={{ minWidth: "9rem" }}>
                    <FormSelect
                      aria-label={`Review status for ${listing.name}`}
                      value={draft.reviewStatus}
                      onChange={(_e, v) => update({ reviewStatus: v as ReviewStatus })}
                    >
                      {REVIEW_STATUSES.map((status) => (
                        <FormSelectOption key={status} value={status} label={status} />
                      ))}
                    </FormSelect>
                  </FlexItem>
                </Flex>
              </FlexItem>
              <FlexItem>
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
              </FlexItem>
              <FlexItem>
                <ListingActionsBar
                  listing={listing}
                  saving={saving}
                  saved={saved}
                  deleting={deleting}
                  onSave={() => void save()}
                  onDelete={requestDelete}
                  onOpenConfig={() => setShowConfig(true)}
                  onOpenTerminal={() => setShowTerminal(true)}
                />
              </FlexItem>
            </Flex>
          </CardBody>
        </Card>
      </GalleryItem>
      {showTerminal && listing.runtime === "openshell" && (
        <LiveTerminal listingId={listing.id} listingName={listing.name} onClose={() => setShowTerminal(false)} />
      )}
      <ListingConfigModal
        listing={listing}
        providers={providers}
        mcpServers={mcpServers}
        skills={skills}
        isOpen={showConfig}
        onClose={() => setShowConfig(false)}
        onChange={onChange}
      />
      <DeleteConfirmModal
        listing={listing}
        isOpen={confirmDeleteOpen}
        deleting={deleting}
        warning={deleteWarning}
        onCancel={cancelDelete}
        onConfirm={() => void confirmDelete()}
        onDismissWarning={dismissDeleteWarning}
      />
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
            <LiveTerminal listingId={listing.id} listingName={listing.name} onClose={() => setShowTerminal(false)} />
          )}
        </Flex>
      </CardBody>
    </Card>
  );
}

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
  const [riskTier, setRiskTier] = useState<RiskTier>("medium");
  const [pricingUnit, setPricingUnit] = useState<PricingUnit>("per-task");
  const [pricingAmount, setPricingAmount] = useState("0.80");
  const [runtime, setRuntime] = useState<AgentRuntime>("generic-chat");
  const [openshellAgent, setOpenshellAgent] = useState("opencode");
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
    if (!description.trim()) return "Description is required";
    return null;
  }

  function validateModes(): string | null {
    if (runtime === "openshell" && !openshellAgent) {
      return "Please select an OpenShell agent from the dropdown";
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
        category: category.trim() || undefined,
        description: description.trim(),
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
                <FormSelect
                  id="wizard-department"
                  value={department}
                  onChange={(_e, v) => {
                    const nextDept = v as DepartmentId;
                    setDepartment(nextDept);
                    // Category is a drill-down *within* a department, so a category
                    // chosen under the old department rarely still makes sense here —
                    // reset it rather than silently keeping a mismatched value.
                    if (!CATEGORY_OPTIONS_BY_DEPARTMENT[nextDept].includes(category)) {
                      setCategory("");
                    }
                  }}
                >
                  {DEPARTMENTS.filter((d) => d.id !== "all").map((d) => (
                    <FormSelectOption key={d.id} value={d.id} label={d.name} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Category (optional)" fieldId="wizard-category">
                <FormSelect id="wizard-category" value={category} onChange={(_e, v) => setCategory(v)}>
                  <FormSelectOption value="" label="No category" />
                  {CATEGORY_OPTIONS_BY_DEPARTMENT[department].map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
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
                  <FormSelectOption
                    value="generic-chat"
                    label="Autonomous agent — Generic chat agent (persistent Deployment + Route)"
                  />
                  <FormSelectOption
                    value="openshell"
                    label="Collaborative agent — OpenShell (interactive coding/engineering sandbox)"
                  />
                </FormSelect>
              </FormGroup>
              {runtime === "openshell" && (
                <>
                  <FormGroup label="OpenShell agent" isRequired fieldId="wizard-openshell-agent">
                    <FormSelect
                      id="wizard-openshell-agent"
                      value={openshellAgent}
                      onChange={(_e, v) => setOpenshellAgent(v)}
                    >
                      {OPENSHELL_AGENTS.map((a) => (
                        <FormSelectOption key={a.id} value={a.id} label={`${a.label} — ${a.description}`} />
                      ))}
                    </FormSelect>
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
