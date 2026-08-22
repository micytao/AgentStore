"use client";

import { useEffect, useState } from "react";
import {
  departmentLabel,
  PROVIDER_KINDS,
  type Listing,
  type ListingUpdate,
  type McpServerStatus,
  type McpTransport,
  type ProviderConfig,
  type ProviderKind,
  type ProviderStatus,
  type ReviewStatus,
  type RiskTier,
  type SecretSummary,
} from "@agentstore/shared";
import { PhaseLabel } from "@/components/PhaseLabel";
import {
  activateProviderConfig,
  clearSecretValue,
  connectMcpServerConfig,
  deleteMcpServerConfig,
  deleteProviderConfig,
  disconnectMcpServerConfig,
  fetchEngineSettings,
  fetchListings,
  fetchMcpServers,
  fetchProviders,
  fetchSecrets,
  fetchTasks,
  setMcpAuthTokenValue,
  setMcpToolEnabledValue,
  setProviderKeyValue,
  setSecretValue,
  testProviderConnection,
  updateEngineSettings,
  updateListingAdmin,
  upsertMcpServerConfig,
  upsertProviderConfig,
  type EngineSettings,
  type Task,
} from "@/lib/api";
import { formatUsd, modeLabel } from "@/lib/format";
import { useRole } from "@/lib/role";

type Tab = "catalog" | "providers" | "mcp" | "secrets" | "engine" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "catalog", label: "Catalog" },
  { id: "providers", label: "Providers" },
  { id: "mcp", label: "MCP" },
  { id: "secrets", label: "Secrets" },
  { id: "engine", label: "Engine" },
  { id: "audit", label: "Tasks & usage" },
];

const RISK_TIERS: RiskTier[] = ["low", "medium", "high"];
const REVIEW_STATUSES: ReviewStatus[] = [
  "draft",
  "in-review",
  "published",
  "deprecated",
];

export function AdminPage() {
  const { isAdmin, toggleRole } = useRole();

  if (!isAdmin) {
    return (
      <div className="store-page store-page-narrow">
        <section className="store-hero is-compact">
          <p className="store-kicker">Restricted</p>
          <h1 className="store-display sm">Admin console</h1>
        </section>
        <div className="store-admin-gate">
          <p>
            Admin mode is off. Flip the switch to manage the catalog, choose
            which engine tasks run on, and audit everything launched across
            departments.
          </p>
          <button
            type="button"
            className="store-btn-primary"
            onClick={toggleRole}
          >
            Turn on Admin mode
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
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`store-tab${tab === item.id ? " is-active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "catalog" && <CatalogManager />}
      {tab === "providers" && <ProvidersPanel />}
      {tab === "mcp" && <McpPanel />}
      {tab === "secrets" && <SecretsPanel />}
      {tab === "engine" && <EngineSettingsPanel />}
      {tab === "audit" && <AuditLog />}
    </div>
  );
}

function CatalogManager() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchListings()
      .then(setListings)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="store-empty">{error}</p>;
  if (!listings) return <div className="store-loading">Loading catalog…</div>;

  return (
    <div className="store-admin-section">
      <div className="store-admin-table">
        <div className="store-admin-row store-admin-row-head">
          <span>Listing</span>
          <span>Risk tier</span>
          <span>Review status</span>
          <span>Coming soon</span>
          <span />
        </div>
        {listings.map((listing) => (
          <ListingRow key={listing.id} listing={listing} />
        ))}
      </div>
    </div>
  );
}

function ListingRow({ listing }: { listing: Listing }) {
  const [draft, setDraft] = useState<Required<ListingUpdate>>({
    name: listing.name,
    description: listing.description,
    riskTier: listing.riskTier,
    reviewStatus: listing.reviewStatus,
    comingSoon: listing.comingSoon ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function update(patch: ListingUpdate) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await updateListingAdmin(listing.id, draft);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="store-admin-row">
      <div>
        <strong>{listing.name}</strong>
        <span>
          {departmentLabel(listing.department)} · {listing.category}
        </span>
      </div>
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
      <label className="store-admin-checkbox">
        <input
          type="checkbox"
          checked={draft.comingSoon}
          onChange={(e) => update({ comingSoon: e.target.checked })}
        />
        Coming soon
      </label>
      <button
        type="button"
        className={`store-btn-ghost store-admin-save${saved ? " is-saved" : ""}`}
        onClick={save}
        disabled={saving}
      >
        {saving ? "Saving…" : saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}

function EngineSettingsPanel() {
  const [settings, setSettings] = useState<EngineSettings | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchEngineSettings(), fetchListings()])
      .then(([nextSettings, nextListings]) => {
        setSettings(nextSettings);
        setListings(nextListings);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function toggleForceSimulated() {
    if (!settings) return;
    const next = await updateEngineSettings({
      forceSimulated: !settings.forceSimulated,
    });
    setSettings(next);
  }

  if (error) return <p className="store-empty">{error}</p>;
  if (!settings || !listings) {
    return <div className="store-loading">Loading engine settings…</div>;
  }

  const wired = listings.filter((listing) => listing.openshellAgent);

  return (
    <div className="store-admin-section">
      <div className="store-panel">
        <h3 className="store-panel-title">Execution engine</h3>
        <p className="store-lede tight">
          Collaborative-mode listings with an OpenShell agent run on a real
          sandbox once an OpenShell gateway is configured. Everything else
          always runs on the simulated engine.
        </p>
        <div className="store-switch-row">
          <button
            type="button"
            className="store-switch-row-btn"
            onClick={toggleForceSimulated}
            aria-pressed={settings.forceSimulated}
            aria-label="Force simulated engine for every task"
          >
            <span
              className={`store-switch${settings.forceSimulated ? " is-on" : ""}`}
              aria-hidden="true"
            >
              <span className="store-switch-knob" />
            </span>
          </button>
          <span>Force simulated engine for every task</span>
        </div>
        <p className="store-lede tight">
          Gateway configured: <strong>{settings.gatewayConfigured ? "Yes" : "No"}</strong>
        </p>
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
            placeholder="Base URL, e.g. https://my-host/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        )}
      </div>
      <div className="store-resource-actions">
        <button
          type="button"
          className="store-btn-primary"
          onClick={save}
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
          <span className={`store-phase is-${provider.hasKey ? "ok" : "warn"}`}>
            {provider.hasKey ? `Key set (${provider.keyPreview})` : "No key"}
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
          disabled={testing || !provider.hasKey}
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

function SecretsPanel() {
  const [secrets, setSecrets] = useState<SecretSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetchSecrets()
      .then(setSecrets)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  if (error) return <p className="store-empty">{error}</p>;
  if (!secrets) return <div className="store-loading">Loading secrets…</div>;

  return (
    <div className="store-admin-section">
      <div className="store-panel">
        <h3 className="store-panel-title">Secrets vault</h3>
        <p className="store-lede tight">
          Values are encrypted at rest in a local vault file. A value saved
          here always takes effect immediately and overrides the matching
          environment variable for the life of this server process. This is
          a prototype-grade vault — not a substitute for a real secrets
          manager.
        </p>

        <div className="store-resource-list">
          {secrets.map((secret) => (
            <SecretRow key={secret.key} secret={secret} onChange={load} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SecretRow({
  secret,
  onChange,
}: {
  secret: SecretSummary;
  onChange: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await setSecretValue(secret.key, value.trim());
      setValue("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await clearSecretValue(secret.key);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="store-resource-card">
      <div className="store-resource-head">
        <div className="store-resource-title">
          <strong>{secret.label}</strong>
          <span>{secret.description} · Used by: {secret.usedBy}</span>
        </div>
        <div className="store-resource-badges">
          <span
            className={`store-phase is-${secret.source === "vault" ? "ok" : secret.source === "env" ? "info" : "muted"}`}
          >
            {secret.source === "vault" ? "Vault" : secret.source === "env" ? "Env" : "Not set"}
          </span>
          {secret.preview && <span className="store-phase is-muted">{secret.preview}</span>}
        </div>
      </div>

      <div className="store-resource-input-row">
        <input
          type="password"
          placeholder="Set a new value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className="store-btn-ghost" onClick={save} disabled={busy || !value.trim()}>
          Save
        </button>
        {secret.hasValue && (
          <button type="button" className="store-btn-ghost" onClick={clear} disabled={busy}>
            Clear
          </button>
        )}
      </div>
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
