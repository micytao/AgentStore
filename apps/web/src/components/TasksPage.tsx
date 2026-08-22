"use client";

import { departmentLabel } from "@agentstore/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PhaseLabel } from "@/components/PhaseLabel";
import { fetchTasks, type Task } from "@/lib/api";
import { formatUsd, modeLabel } from "@/lib/format";

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetchTasks()
        .then(setTasks)
        .catch((err: Error) => setError(err.message));
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="store-page">
      <section className="store-hero is-compact">
        <p className="store-kicker">Across every department</p>
        <h1 className="store-display sm">My tasks</h1>
        <p className="store-lede">
          Live sessions, drafts waiting on you, and everything you have already
          approved.
        </p>
      </section>

      {!tasks && !error ? (
        <div className="store-loading">Loading tasks…</div>
      ) : error ? (
        <p className="store-empty">{error}</p>
      ) : tasks && tasks.length === 0 ? (
        <div className="store-empty-card">
          <p>No tasks yet.</p>
          <Link href="/" className="store-btn-primary">
            Browse catalog
          </Link>
        </div>
      ) : (
        <div className="store-task-list">
          {tasks?.map((task) => (
            <Link key={task.id} href={`/tasks/${task.id}`} className="store-task-row">
              <div>
                <strong>{task.listingName}</strong>
                <span>
                  {departmentLabel(task.department)} · {modeLabel(task.mode)}
                </span>
              </div>
              <PhaseLabel phase={task.status.phase} />
              <em>{formatUsd(task.status.costEstimate ?? 0)}</em>
              <time>{new Date(task.createdAt).toLocaleString()}</time>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
