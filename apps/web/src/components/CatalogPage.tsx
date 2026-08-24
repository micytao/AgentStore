"use client";

import { DEPARTMENTS } from "@agentstore/shared";
import { useEffect, useState } from "react";
import { ListingCard } from "@/components/ListingCard";
import { fetchListings } from "@/lib/api";
import type { Listing } from "@agentstore/shared";

export function CatalogPage() {
  const [department, setDepartment] = useState("all");
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setListings(null);
    fetchListings(department)
      .then(setListings)
      .catch((err: Error) => setError(err.message));
  }, [department]);

  return (
    <div className="store-page">
      <section className="store-hero">
        <p className="store-kicker">Self-service · governed · auditable</p>
        <h1 className="store-display">
          Pick a job.
          <br />
          <em>We stand the agent up.</em>
        </h1>
        <p className="store-lede store-lede-wide">
          Browse business agents by department. Launch one, and Ansible
          Automation Platform provisions it onto the company OpenShift cluster.
          The platform handles the infrastructure — you just review the draft.
        </p>
        <div className="store-path-grid">
          <div className="store-path">
            <span className="store-path-index">A</span>
            <div>
              <strong>Autonomous Mode</strong>
              <p>
                Do this for me. AAP stands up an OpenShift Job. The agent
                drafts; you approve before anything ships.
              </p>
            </div>
          </div>
          <div className="store-path">
            <span className="store-path-index">C</span>
            <div>
              <strong>Collaborative Mode</strong>
              <p>
                Work with me. Engineering specialist agents (optional OpenShell
                sandbox) for live pairing — listed last in the catalog.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="store-filters" role="tablist" aria-label="Department">
        {DEPARTMENTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={department === item.id}
            className={`store-chip${department === item.id ? " is-active" : ""}`}
            onClick={() => setDepartment(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>

      {!listings && !error ? (
        <div className="store-loading">Loading catalog…</div>
      ) : error ? (
        <p className="store-empty">{error}</p>
      ) : listings && listings.length === 0 ? (
        <p className="store-empty">
          Nothing published here yet. Ask an admin to publish an agent, or pick
          another department.
        </p>
      ) : (
        <div className="store-gallery">
          {listings?.map((listing, index) => (
            <div
              key={listing.id}
              className="store-gallery-item"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <ListingCard listing={listing} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
