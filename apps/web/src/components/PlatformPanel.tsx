"use client";

import { useEffect, useState } from "react";
import type {
  EngineSettings,
  PlatformConnectionStatus,
  PlatformSettings,
  PlatformStatus,
  SecretSummary,
} from "@agentstore/shared";
import { SecretField } from "@/components/SecretField";
import {
  fetchEngineSettings,
  fetchPlatformStatus,
  fetchSecrets,
  testPlatformConnection,
  updateEngineSettings,
} from "@/lib/api";

type TestOutcome = { ok: boolean; message: string };

function TestBanner({ result, pending }: { result?: TestOutcome; pending?: boolean }) {
  if (pending) {
    return (
      <p className="store-banner tight is-muted" role="status">
        Testing connection…
      </p>
    );
  }
  if (!result) return null;
  return (
    <p className={`store-banner tight ${result.ok ? "is-ok" : "is-error"}`} role="status">
      {result.message}
    </p>
  );
}

function ConnectionCard({
  name,
  connection,
  url,
  details,
  result,
}: {
  name: string;
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
  const statusClass = connection.connected
    ? "is-live"
    : connection.configured
      ? "is-offline"
      : "is-muted";
  const errorMessage = result && !result.ok ? result.message : connection.error;
  const showError = Boolean(errorMessage && !connection.connected);
  const showSuccess = Boolean(result?.ok);

  return (
    <article className="store-conn-card">
      <h4 className="store-conn-card-title">{name}</h4>
      <dl className="store-conn-dl">
        <div className="store-conn-row">
          <dt>Status</dt>
          <dd>
            <span className={`store-pill ${statusClass}`}>{statusLabel}</span>
          </dd>
        </div>
        <div className="store-conn-row">
          <dt>URL</dt>
          <dd>
            {url ? (
              <span className="store-conn-url" title={url}>
                {url}
              </span>
            ) : (
              <span className="store-conn-empty">Not configured</span>
            )}
          </dd>
        </div>
        {details?.map((item) => (
          <div className="store-conn-row" key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
        {showSuccess ? (
          <div className="store-conn-row is-ok">
            <dt>Result</dt>
            <dd>{result!.message}</dd>
          </div>
        ) : null}
        {showError ? (
          <div className="store-conn-row is-error">
            <dt>Error</dt>
            <dd>{errorMessage}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

export function PlatformPanel() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [engineSettings, setEngineSettings] = useState<EngineSettings | null>(null);
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
    fetchEngineSettings()
      .then(setEngineSettings)
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

  function insecureTlsToggle<K extends "aapInsecureTls" | "openshiftInsecureTls">(key: K) {
    return (
      <label className="store-admin-checkbox">
        <input
          type="checkbox"
          checked={Boolean(draft![key])}
          onChange={(e) =>
            setDraft((prev) => (prev ? { ...prev, [key]: e.target.checked } : prev))
          }
        />
        <span>Allow self-signed certificate (dev/workshop clusters only)</span>
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
        <div className="store-conn-list">
          <ConnectionCard
            name="Ansible Automation Platform"
            connection={status.aap}
            url={status.aap.configured ? status.settings.aapControllerUrl : undefined}
            result={testResults.aap}
          />
          <ConnectionCard
            name="OpenShift (prod)"
            connection={status.openshift}
            url={status.openshift.configured ? status.settings.openshiftApiUrl : undefined}
            details={
              status.openshift.configured
                ? [{ label: "Namespace", value: status.settings.openshiftNamespace || "agent-workloads" }]
                : undefined
            }
            result={testResults.openshift}
          />
        </div>
      </div>

      <div className="store-panel">
        <div className="store-panel-head">
          <h3 className="store-panel-title">AAP controller</h3>
          <button
            type="button"
            className="store-btn-ghost store-btn-compact"
            disabled={testing !== null}
            onClick={() => void test("aap")}
          >
            {testing === "aap" ? "Testing…" : "Test"}
          </button>
        </div>
        <TestBanner result={testResults.aap} pending={testing === "aap"} />
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
        {insecureTlsToggle("aapInsecureTls")}
        {aapToken && <SecretField secret={aapToken} onChange={loadSecrets} />}
      </div>

      <div className="store-panel">
        <div className="store-panel-head">
          <h3 className="store-panel-title">Prod OpenShift</h3>
          <button
            type="button"
            className="store-btn-ghost store-btn-compact"
            disabled={testing !== null}
            onClick={() => void test("openshift")}
          >
            {testing === "openshift" ? "Testing…" : "Test"}
          </button>
        </div>
        <TestBanner result={testResults.openshift} pending={testing === "openshift"} />
        <p className="store-lede tight">
          This must be the <strong>API server</strong> URL, not the web console — usually{" "}
          <code>https://api.&lt;cluster-domain&gt;:6443</code>. It is a different hostname from the console
          (which starts with <code>console-openshift-console.apps.</code>) and almost always needs an explicit
          <code>:6443</code> port.
        </p>
        <div className="store-resource-input-row">
          {field("openshiftApiUrl", "API URL", "https://api.cluster.example.com:6443")}
          {field("openshiftNamespace", "Namespace", "agent-workloads")}
          {field("openshiftConsoleUrl", "Console URL", "https://console-openshift-console.apps.example.com")}
        </div>
        {insecureTlsToggle("openshiftInsecureTls")}
        {openshiftToken && <SecretField secret={openshiftToken} onChange={loadSecrets} />}
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
