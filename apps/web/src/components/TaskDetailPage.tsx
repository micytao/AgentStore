"use client";

import { departmentLabel } from "@agentstore/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PhaseLabel } from "@/components/PhaseLabel";
import { SimulatedTerminal } from "@/components/SimulatedTerminal";
import {
  approveTask,
  cancelTask,
  fetchTask,
  rejectTask,
  type Task,
} from "@/lib/api";
import { formatUsd, modeLabel } from "@/lib/format";

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchTask(taskId)
        .then((next) => {
          if (!cancelled) setTask(next);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        });
    load();
    const timer = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId]);

  async function run(action: () => Promise<Task>) {
    setBusy(true);
    setError(null);
    try {
      setTask(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!task && !error) {
    return (
      <div className="store-page">
        <div className="store-loading">Opening session…</div>
      </div>
    );
  }
  if (!task) {
    return (
      <div className="store-page">
        <p className="store-empty">{error ?? "Task not found"}</p>
      </div>
    );
  }

  const interactive = task.mode === "work-with-me";
  const awaiting = task.status.phase === "AwaitingApproval";
  const running = task.status.phase === "Running";
  const provisioning =
    task.status.phase === "Provisioning" || task.status.phase === "Pending";
  const canStop =
    task.status.phase === "Running" ||
    task.status.phase === "Provisioning" ||
    task.status.phase === "Pending";

  return (
    <div className="store-page store-page-wide">
      <Link href="/tasks" className="store-back">
        ← My tasks
      </Link>
      <header className="store-task-head">
        <div>
          <p className="store-kicker">
            {departmentLabel(task.department)} · {task.requestedBy}
          </p>
          <h1 className="store-launch-title">{task.listingName}</h1>
        </div>
        <div className="store-task-badges">
          <PhaseLabel phase={task.status.phase} />
          <span className={`store-pill ${task.status.live ? "is-live" : ""}`}>
            {task.status.live ? "Live sandbox" : "Simulated"}
          </span>
        </div>
      </header>

      {error ? <p className="store-banner is-error">{error}</p> : null}
      {task.status.error ? (
        <p className="store-banner is-error">{task.status.error}</p>
      ) : null}
      {task.approvalDecision ? (
        <p
          className={`store-banner ${task.approvalDecision === "approved" ? "is-ok" : "is-muted"}`}
        >
          {task.approvalDecision === "approved"
            ? "Approved. The draft was accepted — nothing was sent outside the store."
            : "Rejected. The draft was discarded."}
        </p>
      ) : null}

      <dl className="store-stats">
        <div>
          <dt>Mode</dt>
          <dd>{modeLabel(task.mode)}</dd>
        </div>
        <div>
          <dt>Est. cost</dt>
          <dd>{formatUsd(task.status.costEstimate ?? 0)}</dd>
        </div>
        {task.gitUrl ? (
          <div>
            <dt>Repository</dt>
            <dd>{task.gitUrl}</dd>
          </div>
        ) : null}
        {task.target?.goal ? (
          <div>
            <dt>Goal</dt>
            <dd>{task.target.goal}</dd>
          </div>
        ) : null}
      </dl>

      {interactive && (running || provisioning) ? (
        <section className="store-panel is-terminal">
          {provisioning ? (
            <div className="store-provision">
              <span className="store-pulse" />
              Provisioning an isolated session…
            </div>
          ) : (
            <SimulatedTerminal
              listingName={task.listingName}
              live={task.status.live}
            />
          )}
          {canStop ? (
            <button
              type="button"
              className="store-btn-ghost"
              disabled={busy}
              onClick={() => void run(() => cancelTask(task.id))}
            >
              Stop session
            </button>
          ) : null}
        </section>
      ) : null}

      {!interactive ? (
        <section className="store-panel">
          {provisioning || task.status.phase === "Running" ? (
            <div className="store-provision">
              <span className="store-pulse" />
              Working on your goal. You will approve the draft before anything
              ships.
            </div>
          ) : null}
          {task.status.outputSummary ? (
            <>
              <h2 className="store-panel-title">Draft output</h2>
              <pre className="store-draft">{task.status.outputSummary}</pre>
            </>
          ) : null}
          {awaiting ? (
            <div className="store-actions">
              <button
                type="button"
                className="store-btn-primary"
                disabled={busy}
                onClick={() => void run(() => approveTask(task.id))}
              >
                Approve
              </button>
              <button
                type="button"
                className="store-btn-ghost"
                disabled={busy}
                onClick={() => void run(() => rejectTask(task.id))}
              >
                Reject
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
