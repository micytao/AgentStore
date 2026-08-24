"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
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
  DEPARTMENTS,
  departmentLabel,
  PROVIDER_KINDS,
  type AgentMode,
  type DepartmentId,
  type EngineType,
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
  disconnectMcpServerConfig,
  fetchEngineSettings,
  fetchListings,
  fetchMcpServers,
  fetchProviders,
  fetchSecrets,
  fetchSkills,
  fetchTasks,
  setMcpAuthTokenValue,
  setMcpToolEnabledValue,
  setProviderKeyValue,
  testProviderConnection,
  updateListingAdmin,
  upsertMcpServerConfig,
  upsertProviderConfig,
  upsertSkillConfig,
  type EngineSettings,
  type Task,
} from "@/lib/api";
import { formatUsd, modeLabel } from "@/lib/format";
import { useRole } from "@/lib/role";

type Tab = "catalog" | "platform" | "llms" | "audit";

const TABS: { id: Tab; label: string; icon: ComponentType }[] = [
  { id: "catalog", label: "Catalog", icon: ThLargeIcon },
  { id: "platform", label: "Platform", icon: CloudIcon },
  { id: "llms", label: "LLMs", icon: BrainIcon },
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

export function AdminPage() {
  const { isAdmin, loading, setRole } = useRole();

  if (loading) {
    return (
      <div className="store-page store-page-narrow">
        <div className="store-loading">Checking session…</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="store-page store-page-narrow">
        <section className="store-hero is-compact">
          <p className="store-kicker">Restricted</p>
          <h1 className="store-display sm">Admin console</h1>
        </section>
        <div className="store-admin-gate">
          <p>
            Admin mode is off. Switch to Admin to manage the catalog, onboard
            new agents, choose which engine tasks run on, and audit
            everything launched across departments.
          </p>
          <button type="button" className="store-btn-primary" onClick={() => void setRole("admin")}>
            Switch to Admin
          </button>
        </div>
      </div>
    );
  }

  return <AdminConsole />;
}

function AdminConsole() {
  const [tab, setTab] = useState<Tab>("catalog");

  return (
    <div className="store-page">
      <section className="store-hero is-compact">
        <p className="store-kicker">Admin console</p>
        <h1 className="store-display sm">Configure the store</h1>
        <p className="store-lede tight">
          Manage catalog listings, choose which engine tasks run on, and
          audit every task launched across departments.
        </p>
      </section>

      <div className="store-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`store-tab${tab === item.id ? " is-active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              <span className="store-tab-icon" aria-hidden="true">
                <Icon />
              </span>
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "catalog" && <CatalogManager />}
      {tab === "platform" && <PlatformPanel />}
      {tab === "llms" && <LLMsPanel />}
      {tab === "audit" && <AuditLog />}
    </div>
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

  if (error) return <p className="store-empty">{error}</p>;
  if (!listings) return <div className="store-loading">Loading catalog…</div>;

  return (
    <div className="store-admin-section">
      <div className="store-admin-table-head">
        <h3 className="store-panel-title">Catalog listings</h3>
        <p className="store-lede tight">
          Adjust risk tier, review status, and price per listing — changes
          save immediately. Expand a row to bind a provider, tools, skills,
          and the AAP job template, or delete the agent entirely.
        </p>
      </div>
      <div className="store-admin-table">
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
      </div>

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
        <button type="button" className="store-btn-primary" onClick={() => setShowWizard(true)}>
          + Onboard new agent
        </button>
      )}
    </div>
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
    <div className="store-admin-row-group">
      <div className="store-admin-row">
        <div>
          <strong>{listing.name}</strong>
          <span>
            {departmentLabel(listing.department)} · {listing.category}
            {listing.source === "custom" ? " · Custom" : ""}
          </span>
        </div>
        <div className="store-admin-field">
          <span className="store-admin-field-label">Risk tier</span>
          <select
            value={draft.riskTier}
            onChange={(e) => update({ riskTier: e.target.value as RiskTier })}
          >
            {RISK_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </div>
        <div className="store-admin-field">
          <span className="store-admin-field-label">Review status</span>
          <select
            value={draft.reviewStatus}
            onChange={(e) =>
              update({ reviewStatus: e.target.value as ReviewStatus })
            }
          >
            {REVIEW_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="store-admin-field">
          <span className="store-admin-field-label">Price</span>
          <div className="store-admin-price">
            <input
              inputMode="decimal"
              value={draft.pricing.amount}
              onChange={(e) =>
                update({ pricing: { ...draft.pricing, amount: Number(e.target.value) || 0 } })
              }
            />
            <select
              value={draft.pricing.unit}
              onChange={(e) =>
                update({ pricing: { ...draft.pricing, unit: e.target.value as PricingUnit } })
              }
            >
              {PRICING_UNITS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="store-admin-row-actions">
          <button
            type="button"
            className={`store-btn-ghost store-admin-save${saved ? " is-saved" : ""}`}
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
          <button type="button" className="store-btn-ghost" onClick={() => setShowConfig((v) => !v)}>
            {showConfig ? "Hide config" : "Agent config"}
          </button>
          <button
            type="button"
            className="store-btn-ghost is-danger"
            onClick={() => void remove()}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {showConfig && (
        <AgentConfigPanel
          listing={listing}
          providers={providers}
          mcpServers={mcpServers}
          skills={skills}
          onChange={onChange}
        />
      )}
    </div>
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
    <div className="store-panel store-agent-config">
      <h4 className="store-panel-title">Agent config — {listing.name}</h4>
      <p className="store-lede tight">
        Bind a specific model provider, tool subset, skills, AAP job template,
        and engine override to this agent. Leave provider unset to keep using
        the global active provider. Leave the AAP template unset to use the
        Platform default.
      </p>

      <div className="store-resource-input-row">
        <div className="store-field-mini">
          <span>Model provider</span>
          <select
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              setSaved(false);
            }}
          >
            <option value="">Use global active provider</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="store-field-mini">
          <span>Engine</span>
          <select
            value={engineOverride}
            onChange={(e) => {
              setEngineOverride(e.target.value as "auto" | "simulated" | "live");
              setSaved(false);
            }}
          >
            <option value="auto">Auto (use global engine setting)</option>
            <option value="simulated">Force simulated</option>
            <option value="live">Force live (AAP or OpenShell)</option>
          </select>
        </div>
        <div className="store-field-mini">
          <span>AAP job template id</span>
          <input
            inputMode="numeric"
            placeholder="Platform default"
            value={aapJobTemplateId}
            onChange={(e) => {
              setAapJobTemplateId(e.target.value);
              setSaved(false);
            }}
          />
        </div>
      </div>

      <div>
        <p className="store-lede tight">Tools</p>
        {connectedServers.length === 0 ? (
          <p className="store-resource-empty">
            No connected MCP servers. Connect one in the MCP tab first.
          </p>
        ) : (
          connectedServers.map((server) => (
            <div key={server.id} className="store-resource-tools">
              <strong>{server.name}</strong>
              {server.tools.length === 0 ? (
                <p className="store-resource-empty">No tools advertised.</p>
              ) : (
                server.tools.map((tool) => (
                  <label key={tool.name} className="store-resource-tool">
                    <span>{tool.name}</span>
                    <input
                      type="checkbox"
                      checked={toolBindings.some((b) => b.serverId === server.id && b.tool === tool.name)}
                      onChange={() => toggleTool(server.id, tool.name)}
                    />
                  </label>
                ))
              )}
            </div>
          ))
        )}
      </div>

      <div>
        <p className="store-lede tight">Skills</p>
        {skills.length === 0 ? (
          <p className="store-resource-empty">No skills authored yet. Add one in the Skills tab.</p>
        ) : (
          skills.map((skill) => (
            <label key={skill.id} className="store-resource-tool">
              <span>{skill.name}</span>
              <input
                type="checkbox"
                checked={skillIds.includes(skill.id)}
                onChange={() => toggleSkill(skill.id)}
              />
            </label>
          ))
        )}
      </div>

      <div className="store-resource-actions">
        <button
          type="button"
          className={`store-btn-primary store-admin-save${saved ? " is-saved" : ""}`}
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save agent config"}
        </button>
      </div>
    </div>
  );
}

const ICON_OPTIONS: { id: string; label: string }[] = [
  { id: "code", label: "Code" },
  { id: "comments", label: "Comments" },
  { id: "shield", label: "Shield" },
  { id: "chart", label: "Chart" },
  { id: "money", label: "Money" },
];

const WIZARD_STEPS = ["Basics", "Modes & engine", "Model & tools", "Skills", "Review & publish"];

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
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState<DepartmentId>("engineering");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("code");
  const [riskTier, setRiskTier] = useState<RiskTier>("medium");
  const [pricingUnit, setPricingUnit] = useState<PricingUnit>("per-task");
  const [pricingAmount, setPricingAmount] = useState("0.80");
  const [supportedModes, setSupportedModes] = useState<AgentMode[]>(["do-this-for-me"]);
  const [engineType, setEngineType] = useState<EngineType>("hosted-agent-api");
  const [openshellAgent, setOpenshellAgent] = useState("");
  const [engineOverride, setEngineOverride] = useState<"auto" | "simulated" | "live">("auto");
  const [providerId, setProviderId] = useState("");
  const [toolBindings, setToolBindings] = useState<{ serverId: string; tool: string }[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const connectedServers = mcpServers.filter((s) => s.connectionState === "connected");

  function toggleMode(mode: AgentMode) {
    setSupportedModes((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));
  }
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

  function validateStep(): string | null {
    if (step === 0) {
      if (!name.trim()) return "Name is required";
      if (!category.trim()) return "Category is required";
      if (!description.trim()) return "Description is required";
    }
    if (step === 1) {
      if (supportedModes.length === 0) return "Pick at least one mode";
      if (engineType === "self-hosted-sandbox" && !openshellAgent.trim()) {
        return "OpenShell agent identifier is required for self-hosted sandbox agents";
      }
    }
    return null;
  }

  function next() {
    const validationError = validateStep();
    if (validationError) {
      setErr(validationError);
      return;
    }
    setErr(null);
    setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  }

  function back() {
    setErr(null);
    setStep((s) => Math.max(s - 1, 0));
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
        supportedModes,
        riskTier,
        pricing: { unit: pricingUnit, amount: Number(pricingAmount) || 0 },
        openshellAgent: engineType === "self-hosted-sandbox" ? openshellAgent.trim() : undefined,
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
    supportedModes: supportedModes.length > 0 ? supportedModes : ["do-this-for-me"],
    riskTier,
    reviewStatus: "draft",
    pricing: { unit: pricingUnit, amount: Number(pricingAmount) || 0 },
  };

  return (
    <div className="store-panel store-wizard">
      <div className="store-wizard-steps">
        {WIZARD_STEPS.map((label, idx) => (
          <span
            key={label}
            className={`store-wizard-step${idx === step ? " is-active" : idx < step ? " is-done" : ""}`}
          >
            {idx + 1}. {label}
          </span>
        ))}
      </div>

      {err && <p className="store-banner is-error">{err}</p>}

      {step === 0 && (
        <div className="store-wizard-body">
          <div className="store-resource-input-row">
            <input
              placeholder="Agent name, e.g. Contract summarizer"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select value={department} onChange={(e) => setDepartment(e.target.value as DepartmentId)}>
              {DEPARTMENTS.filter((d) => d.id !== "all").map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="store-resource-input-row">
            <input
              placeholder="Category, e.g. Contract review"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <select value={icon} onChange={(e) => setIcon(e.target.value)}>
              {ICON_OPTIONS.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
            <select value={riskTier} onChange={(e) => setRiskTier(e.target.value as RiskTier)}>
              {RISK_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier} risk
                </option>
              ))}
            </select>
          </div>
          <div className="store-resource-input-row">
            <label className="store-field-mini">
              <span>Price (USD)</span>
              <input
                inputMode="decimal"
                value={pricingAmount}
                onChange={(e) => setPricingAmount(e.target.value)}
              />
            </label>
            <label className="store-field-mini">
              <span>Billed</span>
              <select value={pricingUnit} onChange={(e) => setPricingUnit(e.target.value as PricingUnit)}>
                {PRICING_UNITS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <textarea
            rows={3}
            className="store-textarea"
            placeholder="What does this agent do?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      )}

      {step === 1 && (
        <div className="store-wizard-body">
          <div className="store-resource-input-row">
            <label className="store-admin-checkbox">
              <input
                type="checkbox"
                checked={supportedModes.includes("do-this-for-me")}
                onChange={() => toggleMode("do-this-for-me")}
              />
              Autonomous (do this for me)
            </label>
            <label className="store-admin-checkbox">
              <input
                type="checkbox"
                checked={supportedModes.includes("work-with-me")}
                onChange={() => toggleMode("work-with-me")}
              />
              Collaborative (work with me)
            </label>
          </div>
          <div className="store-resource-input-row">
            <select value={engineType} onChange={(e) => setEngineType(e.target.value as EngineType)}>
              <option value="hosted-agent-api">Hosted agent API (AAP → OpenShift)</option>
              <option value="self-hosted-sandbox">Self-hosted sandbox (OpenShell)</option>
            </select>
            {engineType === "self-hosted-sandbox" && (
              <input
                placeholder="OpenShell agent identifier, e.g. claude"
                value={openshellAgent}
                onChange={(e) => setOpenshellAgent(e.target.value)}
              />
            )}
            <select
              value={engineOverride}
              onChange={(e) => setEngineOverride(e.target.value as "auto" | "simulated" | "live")}
            >
              <option value="auto">Auto (use global engine setting)</option>
              <option value="simulated">Force simulated</option>
              <option value="live">Force live (AAP + OpenShift)</option>
            </select>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="store-wizard-body">
          <div className="store-resource-input-row">
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Use global active provider</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {connectedServers.length === 0 ? (
            <p className="store-resource-empty">
              No connected MCP servers yet — connect one in the MCP tab to bind
              tools now, or skip and bind later.
            </p>
          ) : (
            connectedServers.map((server) => (
              <div key={server.id} className="store-resource-tools">
                <strong>{server.name}</strong>
                {server.tools.map((tool) => (
                  <label key={tool.name} className="store-resource-tool">
                    <span>{tool.name}</span>
                    <input
                      type="checkbox"
                      checked={toolBindings.some((b) => b.serverId === server.id && b.tool === tool.name)}
                      onChange={() => toggleTool(server.id, tool.name)}
                    />
                  </label>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {step === 3 && (
        <div className="store-wizard-body">
          {skills.length === 0 ? (
            <p className="store-resource-empty">
              No skills authored yet — add one in the Skills tab, or skip and
              attach later.
            </p>
          ) : (
            skills.map((skill) => (
              <label key={skill.id} className="store-resource-tool">
                <span>
                  {skill.name}
                  {skill.description ? ` — ${skill.description}` : ""}
                </span>
                <input
                  type="checkbox"
                  checked={skillIds.includes(skill.id)}
                  onChange={() => toggleSkill(skill.id)}
                />
              </label>
            ))
          )}
        </div>
      )}

      {step === 4 && (
        <div className="store-wizard-body">
          <p className="store-lede tight">This is what users will see in the catalog:</p>
          <div className="store-wizard-preview">
            <ListingCard listing={previewListing} />
          </div>
        </div>
      )}

      <div className="store-resource-actions store-wizard-actions">
        {step > 0 && (
          <button type="button" className="store-btn-ghost" onClick={back} disabled={saving}>
            Back
          </button>
        )}
        <button type="button" className="store-btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        {step < WIZARD_STEPS.length - 1 ? (
          <button type="button" className="store-btn-primary" onClick={next}>
            Next
          </button>
        ) : (
          <>
            <button
              type="button"
              className="store-btn-ghost"
              onClick={() => void submit(false)}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save as draft"}
            </button>
            <button
              type="button"
              className="store-btn-primary"
              onClick={() => void submit(true)}
              disabled={saving}
            >
              {saving ? "Publishing…" : "Publish now"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type LLMsSubTab = "providers" | "mcp" | "skills" | "openshell";

const LLMS_SUBTABS: { id: LLMsSubTab; label: string; icon: ComponentType }[] = [
  { id: "providers", label: "Providers", icon: PlugIcon },
  { id: "mcp", label: "MCP", icon: NetworkIcon },
  { id: "skills", label: "Skills", icon: BookIcon },
  { id: "openshell", label: "OpenShell", icon: TerminalIcon },
];

function LLMsPanel() {
  const [subTab, setSubTab] = useState<LLMsSubTab>("providers");

  return (
    <div className="store-admin-section">
      <div className="store-tabs is-compact" role="tablist" aria-label="LLM sections">
        {LLMS_SUBTABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={subTab === item.id}
              className={`store-tab is-compact${subTab === item.id ? " is-active" : ""}`}
              onClick={() => setSubTab(item.id)}
            >
              <span className="store-tab-icon" aria-hidden="true">
                <Icon />
              </span>
              {item.label}
            </button>
          );
        })}
      </div>

      {subTab === "providers" && <ProvidersPanel />}
      {subTab === "mcp" && <McpPanel />}
      {subTab === "skills" && <SkillsPanel />}
      {subTab === "openshell" && <OpenShellPanel />}
    </div>
  );
}

function OpenShellPanel() {
  const [settings, setSettings] = useState<EngineSettings | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  function loadSecrets() {
    fetchSecrets()
      .then(setSecrets)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    Promise.all([fetchEngineSettings(), fetchListings()])
      .then(([nextSettings, nextListings]) => {
        setSettings(nextSettings);
        setListings(nextListings);
      })
      .catch((err: Error) => setError(err.message));
    loadSecrets();
  }, []);

  if (error) return <p className="store-empty">{error}</p>;
  if (!settings || !listings) {
    return <div className="store-loading">Loading OpenShell settings…</div>;
  }

  const wired = listings.filter((listing) => listing.openshellAgent);
  const gatewayToken = secrets.find((s) => s.key === "OPENSHELL_GATEWAY_TOKEN");
  const gitPat = secrets.find((s) => s.key === "GIT_PAT");

  return (
    <div className="store-admin-section">
      <div className="store-panel">
        <h3 className="store-panel-title">OpenShell sandbox</h3>
        <p className="store-lede tight">
          Engineering listings with an OpenShell agent run interactively in a
          self-hosted sandbox reached through the OpenShell gateway, instead
          of AAP/OpenShift.
        </p>
        <p className="store-lede tight">
          Gateway configured: <strong>{settings.gatewayConfigured ? "Yes" : "No"}</strong>
        </p>
        {gatewayToken && <SecretField secret={gatewayToken} onChange={loadSecrets} />}
        {gitPat && <SecretField secret={gitPat} onChange={loadSecrets} />}
      </div>

      <div className="store-panel">
        <h3 className="store-panel-title">Listings wired to OpenShell</h3>
        {wired.length === 0 ? (
          <p className="store-lede tight">
            No listing has an OpenShell agent configured yet.
          </p>
        ) : (
          <div className="store-admin-table">
            {wired.map((listing) => (
              <div className="store-admin-row" key={listing.id}>
                <div>
                  <strong>{listing.name}</strong>
                  <span>{departmentLabel(listing.department)}</span>
                </div>
                <span>{listing.openshellAgent}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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

  if (error) return <p className="store-empty">{error}</p>;
  if (!providers) return <div className="store-loading">Loading providers…</div>;

  return (
    <div className="store-admin-section">
      <div className="store-panel">
        <h3 className="store-panel-title">Model providers</h3>
        <p className="store-lede tight">
          Add a real API key for a provider, test the connection, and mark
          one provider active. The active provider is used to generate real
          drafts for Autonomous-mode tasks, replacing the simulated text.
        </p>

        {providers.length === 0 && (
          <p className="store-resource-empty">No providers configured yet.</p>
        )}

        <div className="store-resource-list">
          {providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} onChange={load} />
          ))}
        </div>

        {showAdd ? (
          <AddProviderForm
            onDone={() => {
              setShowAdd(false);
              load();
            }}
            onCancel={() => setShowAdd(false)}
          />
        ) : (
          <button
            type="button"
            className="store-btn-ghost"
            onClick={() => setShowAdd(true)}
          >
            + Add provider
          </button>
        )}
      </div>
    </div>
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

  function applyVllmPreset() {
    setKind("openai-compatible");
    setLabel((prev) => prev || "vLLM (local MaaS)");
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
    <div className="store-resource-add">
      {err && <p className="store-banner is-error">{err}</p>}
      <p className="store-lede tight">
        Quick preset:{" "}
        <button type="button" className="store-btn-ghost" onClick={applyVllmPreset}>
          Self-hosted / vLLM (MaaS)
        </button>{" "}
        — points an OpenAI-compatible provider at a local vLLM server; no API
        key required.
      </p>
      <div className="store-resource-input-row">
        <select value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
          {PROVIDER_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          placeholder="Label, e.g. Anthropic (prod)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        {kind === "openai-compatible" && (
          <input
            placeholder="Base URL, e.g. http://localhost:8000/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        )}
      </div>
      {kind === "openai-compatible" && (
        <p className="store-resource-empty">
          No API key needed for a self-hosted server with no auth configured
          — leave the key blank after adding and just hit &quot;Test
          connection&quot;.
        </p>
      )}
      <div className="store-resource-actions">
        <button
          type="button"
          className="store-btn-primary"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? "Adding…" : "Add provider"}
        </button>
        <button type="button" className="store-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
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
    <div className="store-resource-card">
      <div className="store-resource-head">
        <div className="store-resource-title">
          <strong>{provider.label}</strong>
          <span>{PROVIDER_KINDS.find((k) => k.id === provider.kind)?.label ?? provider.kind}</span>
        </div>
        <div className="store-resource-badges">
          <span className={`store-phase is-${provider.active ? "ok" : "muted"}`}>
            {provider.active ? "Active" : "Inactive"}
          </span>
          <span
            className={`store-phase is-${
              provider.hasKey ? "ok" : provider.kind === "openai-compatible" ? "muted" : "warn"
            }`}
          >
            {provider.hasKey
              ? `Key set (${provider.keyPreview})`
              : provider.kind === "openai-compatible"
                ? "No key (optional for self-hosted servers)"
                : "No key"}
          </span>
          {provider.lastError && <span className="store-phase is-bad">Test failed</span>}
          {provider.lastChecked && !provider.lastError && (
            <span className="store-phase is-info">Tested OK</span>
          )}
        </div>
      </div>

      <div className="store-resource-input-row">
        <input
          type="password"
          placeholder="Paste API key"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
        />
        <button
          type="button"
          className="store-btn-ghost"
          onClick={saveKey}
          disabled={savingKey || !keyInput.trim()}
        >
          {savingKey ? "Saving…" : "Save key"}
        </button>
        <button
          type="button"
          className="store-btn-ghost"
          onClick={test}
          disabled={testing || (!provider.hasKey && provider.kind !== "openai-compatible")}
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
      </div>

      {provider.lastError && <p className="store-banner is-error">{provider.lastError}</p>}

      {provider.models && provider.models.length > 0 && (
        <div className="store-resource-input-row">
          <select value={model} onChange={(e) => saveModel(e.target.value)}>
            <option value="">Default model…</option>
            {provider.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="store-resource-actions">
        {!provider.active && (
          <button type="button" className="store-btn-ghost" onClick={activate} disabled={busy}>
            Make active
          </button>
        )}
        <button type="button" className="store-btn-ghost" onClick={remove} disabled={busy}>
          Remove
        </button>
      </div>
    </div>
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

  if (error) return <p className="store-empty">{error}</p>;
  if (!servers) return <div className="store-loading">Loading MCP servers…</div>;

  return (
    <div className="store-admin-section">
      <div className="store-panel">
        <h3 className="store-panel-title">MCP servers &amp; tools</h3>
        <p className="store-lede tight">
          Connect a real MCP server, then enable individual tools you want
          Autonomous-mode drafting to be able to call.{" "}
          <strong>stdio servers run a local command you specify — only
          connect servers you trust.</strong>
        </p>

        {servers.length === 0 && (
          <p className="store-resource-empty">No MCP servers registered yet.</p>
        )}

        <div className="store-resource-list">
          {servers.map((server) => (
            <McpServerRow key={server.id} server={server} onChange={load} />
          ))}
        </div>

        {showAdd ? (
          <AddMcpServerForm
            onDone={() => {
              setShowAdd(false);
              load();
            }}
            onCancel={() => setShowAdd(false)}
          />
        ) : (
          <button type="button" className="store-btn-ghost" onClick={() => setShowAdd(true)}>
            + Add MCP server
          </button>
        )}
      </div>
    </div>
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
    <div className="store-resource-add">
      {err && <p className="store-banner is-error">{err}</p>}
      <div className="store-resource-input-row">
        <select value={transport} onChange={(e) => setTransport(e.target.value as McpTransport)}>
          {MCP_TRANSPORTS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {transport === "stdio" ? (
        <div className="store-resource-input-row">
          <input
            placeholder="Command, e.g. npx"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <input
            placeholder="Args, space separated"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
        </div>
      ) : (
        <div className="store-resource-input-row">
          <input
            placeholder="Server URL, e.g. https://host/mcp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      )}
      <div className="store-resource-actions">
        <button type="button" className="store-btn-primary" onClick={save} disabled={saving}>
          {saving ? "Adding…" : "Add server"}
        </button>
        <button type="button" className="store-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
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

  const stateTone =
    server.connectionState === "connected"
      ? "ok"
      : server.connectionState === "error"
        ? "bad"
        : "muted";

  return (
    <div className="store-resource-card">
      <div className="store-resource-head">
        <div className="store-resource-title">
          <strong>{server.name}</strong>
          <span>
            {MCP_TRANSPORTS.find((t) => t.id === server.transport)?.label ?? server.transport} ·{" "}
            {server.transport === "stdio" ? server.command : server.url}
          </span>
        </div>
        <div className="store-resource-badges">
          <span className={`store-phase is-${stateTone}`}>{server.connectionState}</span>
        </div>
      </div>

      {server.lastError && <p className="store-banner is-error">{server.lastError}</p>}

      {server.transport !== "stdio" && (
        <div className="store-resource-input-row">
          <input
            type="password"
            placeholder={server.hasAuthToken ? "Auth token set — enter to replace" : "Bearer auth token (optional)"}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <button
            type="button"
            className="store-btn-ghost"
            onClick={saveToken}
            disabled={busy || !tokenInput.trim()}
          >
            Save token
          </button>
        </div>
      )}

      <div className="store-resource-actions">
        <button type="button" className="store-btn-ghost" onClick={connect} disabled={connecting}>
          {connecting ? "Connecting…" : server.connectionState === "connected" ? "Reconnect" : "Connect"}
        </button>
        {server.connectionState === "connected" && (
          <button type="button" className="store-btn-ghost" onClick={disconnect} disabled={busy}>
            Disconnect
          </button>
        )}
        <button type="button" className="store-btn-ghost" onClick={remove} disabled={busy}>
          Remove
        </button>
      </div>

      {server.connectionState === "connected" && (
        <div className="store-resource-tools">
          {server.tools.length === 0 ? (
            <p className="store-resource-empty">This server did not advertise any tools.</p>
          ) : (
            server.tools.map((tool) => (
              <label key={tool.name} className="store-resource-tool">
                <span>
                  {tool.name}
                  {tool.description && (
                    <span className="store-resource-tool-desc">{tool.description}</span>
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={tool.enabled}
                  onChange={(e) => toggleTool(tool.name, e.target.checked)}
                />
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function load() {
    fetchSkills()
      .then(setSkills)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  if (error) return <p className="store-empty">{error}</p>;
  if (!skills) return <div className="store-loading">Loading skills…</div>;

  return (
    <div className="store-admin-section">
      <div className="store-panel">
        <h3 className="store-panel-title">Skills library</h3>
        <p className="store-lede tight">
          Author reusable instruction bundles once, then attach one or more
          to any agent (from the Catalog tab or the onboarding wizard). A
          skill&apos;s instructions are merged into that agent&apos;s system
          prompt when it drafts.
        </p>

        {skills.length === 0 && (
          <p className="store-resource-empty">No skills authored yet.</p>
        )}

        <div className="store-resource-list">
          {skills.map((skill) => (
            <SkillRow key={skill.id} skill={skill} onChange={load} />
          ))}
        </div>

        {showAdd ? (
          <AddSkillForm
            onDone={() => {
              setShowAdd(false);
              load();
            }}
            onCancel={() => setShowAdd(false)}
          />
        ) : (
          <button type="button" className="store-btn-ghost" onClick={() => setShowAdd(true)}>
            + Add skill
          </button>
        )}
      </div>
    </div>
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
    <div className="store-resource-add">
      {err && <p className="store-banner is-error">{err}</p>}
      <div className="store-resource-input-row">
        <input placeholder="Name, e.g. Billing tone guide" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          placeholder="Short description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <textarea
        rows={4}
        placeholder="Instructions to merge into the agent's system prompt…"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        className="store-textarea"
      />
      <div className="store-resource-actions">
        <button type="button" className="store-btn-primary" onClick={save} disabled={saving}>
          {saving ? "Adding…" : "Add skill"}
        </button>
        <button type="button" className="store-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SkillRow({ skill, onChange }: { skill: Skill; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
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

  return (
    <div className="store-resource-card">
      <div className="store-resource-head">
        <div className="store-resource-title">
          <strong>{skill.name}</strong>
          {skill.description && <span>{skill.description}</span>}
        </div>
        <div className="store-resource-actions">
          <button type="button" className="store-btn-ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </button>
          <button type="button" className="store-btn-ghost" onClick={remove} disabled={busy}>
            Remove
          </button>
        </div>
      </div>

      {editing ? (
        <>
          <div className="store-resource-input-row">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <textarea
            rows={4}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="store-textarea"
          />
          <div className="store-resource-actions">
            <button type="button" className="store-btn-primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      ) : (
        <p className="store-resource-tool-desc">{skill.instructions}</p>
      )}
    </div>
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

  if (error) return <p className="store-empty">{error}</p>;
  if (!tasks) return <div className="store-loading">Loading tasks…</div>;
  if (tasks.length === 0) {
    return <p className="store-empty">No tasks have been launched yet.</p>;
  }

  return (
    <div className="store-audit-table">
      <div className="store-audit-row store-audit-row-head">
        <span>Listing</span>
        <span>Department</span>
        <span>Mode</span>
        <span>Phase</span>
        <span>Engine</span>
        <span>Cost</span>
      </div>
      {tasks.map((task) => (
        <div className="store-audit-row" key={task.id}>
          <strong>{task.listingName}</strong>
          <span>{departmentLabel(task.department)}</span>
          <span>{modeLabel(task.mode)}</span>
          <PhaseLabel phase={task.status.phase} />
          <span>{task.status.live ? "Live" : "Simulated"}</span>
          <span>{formatUsd(task.status.costEstimate ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}
