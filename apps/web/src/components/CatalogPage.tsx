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
        <p className="store-kicker">Internal · governed · self-service</p>
        <h1 className="store-display">
          Agents that do the work,
          <br />
          <em>not another chatbot.</em>
        </h1>
        <p className="store-lede">
          Browse the company catalog. Point an agent at your task. Autonomous
          listings draft and wait for approval. Collaborative listings are live
          sessions you drive.
        </p>
        <div className="store-path-grid">
          <div className="store-path">
            <span className="store-path-index">A</span>
            <div>
              <strong>Autonomous Mode</strong>
              <p>
                Do this for me. Unattended. The agent drafts; you approve before
                anything ships.
              </p>
            </div>
          </div>
          <div className="store-path">
            <span className="store-path-index">C</span>
            <div>
              <strong>Collaborative Mode</strong>
              <p>
                Work with me. Interactive. You drive a coding agent in an
                isolated session.
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
          Nothing published here yet. Finance &amp; HR listings are still in
          review.
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
