"use client";

import { useEffect, useState } from "react";
import type { EngineSettings, PlatformSettings, PlatformStatus, SecretSummary } from "@agentstore/shared";
import { SecretField } from "@/components/SecretField";
import {
  fetchEngineSettings,
  fetchPlatformStatus,
  fetchSecrets,
  updateEngineSettings,
  updatePlatformSettings,
} from "@/lib/api";

export function PlatformPanel() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [engineSettings, setEngineSettings] = useState<EngineSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    fetchEngineSettings()
      .then(setEngineSettings)
      .catch((err: Error) => setError(err.message));
    loadSecrets();
  }

  useEffect(load, []);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updatePlatformSettings({
        ...draft,
        aapJobTemplateId:
          draft.aapJobTemplateId === "" || draft.aapJobTemplateId === undefined
            ? ""
            : Number(draft.aapJobTemplateId),
      });
      setStatus(next);
      setDraft(next.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleForceSimulated() {
    if (!engineSettings) return;
    const next = await updateEngineSettings({
      forceSimulated: !engineSettings.forceSimulated,
    });
    setEngineSettings(next);
  }

  if (error && !status) return <p className="store-empty">{error}</p>;
  if (!status || !draft) return <div className="store-loading">Loading platform…</div>;

  function field<K extends keyof PlatformSettings>(key: K, label: string, placeholder = "") {
    return (
      <label className="store-field-mini">
        <span>{label}</span>
        <input
          value={String(draft![key] ?? "")}
          placeholder={placeholder}
          onChange={(e) =>
            setDraft((prev) =>
              prev ? { ...prev, [key]: e.target.value } : prev
            )
          }
        />
      </label>
    );
  }

  const aapToken = secrets.find((s) => s.key === "AAP_TOKEN");
  const openshiftToken = secrets.find((s) => s.key === "OPENSHIFT_TOKEN");

  return (
    <div className="store-admin-section">
      {error ? <p className="store-banner is-error">{error}</p> : null}

      <div className="store-panel">
        <h3 className="store-panel-title">Connections</h3>
        <p className="store-lede tight">
          AgentStore is a console. It talks to Ansible Automation Platform to
          provision, and to prod OpenShift to watch the Job that actually
          runs. URLs and tokens for both are configured below.
        </p>
        <div className="store-admin-table">
          <div className="store-admin-row">
            <div>
              <strong>Ansible Automation Platform</strong>
              <span>{status.aap.configured ? status.settings.aapControllerUrl || "URL set" : "Not configured"}</span>
            </div>
            <span className={`store-pill ${status.aap.connected ? "is-live" : ""}`}>
              {status.aap.connected ? "Connected" : status.aap.error ?? "Disconnected"}
            </span>
          </div>
          <div className="store-admin-row">
            <div>
              <strong>OpenShift (prod)</strong>
              <span>
                {status.openshift.configured
                  ? `${status.settings.openshiftNamespace || "agent-workloads"} @ ${status.settings.openshiftApiUrl}`
                  : "Not configured"}
              </span>
            </div>
            <span className={`store-pill ${status.openshift.connected ? "is-live" : ""}`}>
              {status.openshift.connected ? "Connected" : status.openshift.error ?? "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      <div className="store-panel">
        <h3 className="store-panel-title">AAP controller</h3>
        <div className="store-resource-input-row">
          {field("aapControllerUrl", "Controller URL", "https://aap.example.com")}
          {field("aapConsoleUrl", "Console URL (deep links)", "https://aap.example.com")}
          {field("aapJobTemplateId", "Default job template id", "42")}
        </div>
        {status.aap.jobTemplates.length > 0 ? (
          <p className="store-lede tight">
            Templates:{" "}
            {status.aap.jobTemplates
              .slice(0, 8)
              .map((t) => `${t.name} (#${t.id})`)
              .join(" · ")}
          </p>
        ) : null}
        {aapToken && <SecretField secret={aapToken} onChange={loadSecrets} />}
      </div>

      <div className="store-panel">
        <h3 className="store-panel-title">Prod OpenShift</h3>
        <div className="store-resource-input-row">
          {field("openshiftApiUrl", "API URL", "https://api.cluster.example.com:6443")}
          {field("openshiftNamespace", "Namespace", "agent-workloads")}
          {field("openshiftConsoleUrl", "Console URL", "https://console-openshift-console.apps.example.com")}
        </div>
        {openshiftToken && <SecretField secret={openshiftToken} onChange={loadSecrets} />}
      </div>

      <div className="store-actions">
        <button type="button" className="store-btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save & test"}
        </button>
      </div>

      {engineSettings && (
        <div className="store-panel">
          <h3 className="store-panel-title">Execution</h3>
          <p className="store-lede tight">
            Business listings are provisioned by AAP onto prod OpenShift. If
            AAP is not connected, launches use a labeled simulated job
            instead. Use this switch to force every task simulated,
            regardless of connection status.
          </p>
          <div className="store-switch-row">
            <button
              type="button"
              className="store-switch-row-btn"
              onClick={() => void toggleForceSimulated()}
              aria-pressed={engineSettings.forceSimulated}
              aria-label="Force simulated engine for every task"
            >
              <span
                className={`store-switch${engineSettings.forceSimulated ? " is-on" : ""}`}
                aria-hidden="true"
              >
                <span className="store-switch-knob" />
              </span>
            </button>
            <span>Force simulated engine for every task</span>
          </div>
        </div>
      )}

      <div className="store-panel">
        <h3 className="store-panel-title">Recent AAP jobs</h3>
        {status.aap.recentJobs.length === 0 ? (
          <p className="store-lede tight">No jobs yet — or AAP is not connected.</p>
        ) : (
          <div className="store-admin-table">
            {status.aap.recentJobs.map((job) => (
              <div className="store-admin-row" key={job.id}>
                <div>
                  <strong>#{job.id} {job.name}</strong>
                  <span>{job.status}</span>
                </div>
                {job.url ? (
                  <a href={job.url} target="_blank" rel="noreferrer">
                    Open in AAP
                  </a>
                ) : (
                  <span>{job.started ?? ""}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="store-panel">
        <h3 className="store-panel-title">Agent Jobs on OpenShift</h3>
        {status.openshift.jobs.length === 0 ? (
          <p className="store-lede tight">
            No <code>agent-*</code> Jobs in {status.settings.openshiftNamespace || "agent-workloads"}.
          </p>
        ) : (
          <div className="store-admin-table">
            {status.openshift.jobs.map((job) => (
              <div className="store-admin-row" key={`${job.namespace}/${job.name}`}>
                <div>
                  <strong>{job.name}</strong>
                  <span>
                    {job.namespace}
                    {job.taskId ? ` · task ${job.taskId}` : ""}
                  </span>
                </div>
                <span>
                  {job.succeeded ? "succeeded" : job.failed ? "failed" : job.active ? "active" : "pending"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
