"use client";

import { useState } from "react";
import type { SecretSummary } from "@agentstore/shared";
import { clearSecretValue, setSecretValue } from "@/lib/api";

/** Inline card for viewing/setting/clearing a single fixed secret slot.
 * Shared by the Platform tab (AAP/OpenShift tokens) and the LLMs tab's
 * OpenShell sub-tab (gateway token, git PAT). */
export function SecretField({
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
          <span>
            {secret.description} · Used by: {secret.usedBy}
          </span>
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
        <button type="button" className="store-btn-ghost" onClick={() => void save()} disabled={busy || !value.trim()}>
          Save
        </button>
        {secret.hasValue && (
          <button type="button" className="store-btn-ghost" onClick={() => void clear()} disabled={busy}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
