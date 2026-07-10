"use client";

import { useState } from "react";
import { useMeshModels } from "../lib/use-mesh-models";

/**
 * A quiet, dismissible one-liner shown above the chat when a served model is
 * currently split across several contributors. It builds the "answers come
 * from the swarm" mental model without shouting — a muted chip, not a banner.
 * The technical detail (pipeline vs MoE, pooled GB) lives in the title on hover.
 *
 * Renders null when the runtime predates the schema, nothing is split, or the
 * user has dismissed it this session.
 */
export function MeshAwareNote() {
  const { models, loading, online } = useMeshModels();
  const [dismissed, setDismissed] = useState(false);

  if (loading || !online || dismissed) return null;

  const splits = models.filter(
    (m) =>
      m.status === "warm" &&
      (m.splitKind === "pipeline" || m.splitKind === "moe"),
  );
  if (splits.length === 0) return null;

  const lead = splits[0];
  const detail =
    lead.splitKind === "pipeline"
      ? `${lead.displayName || lead.name} is running across ${lead.nodeCount} peers pooling ${lead.meshVramGb.toFixed(0)} GB (pipeline split).`
      : `${lead.displayName || lead.name} is running as ${lead.nodeCount} MoE shards pooling ${lead.meshVramGb.toFixed(0)} GB.`;

  return (
    <div className="flex justify-center">
      <span
        title={detail}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1 text-[11px] text-[var(--fg-muted)]"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--info)]" />
        Answered by the swarm — {lead.nodeCount} peers pooled
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="ml-0.5 text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)]"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    </div>
  );
}
