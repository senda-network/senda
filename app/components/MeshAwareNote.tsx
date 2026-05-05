"use client";

import { useMeshModels } from "../lib/use-mesh-models";

/**
 * Tiny "this answer is going to come from the swarm" line shown above the
 * chat composer when the mesh is currently running a model that's split
 * across multiple contributors. Builds the mental model in the highest
 * traffic surface — most users land in chat first, and this is where the
 * mesh's collective behavior is least visible.
 *
 * Renders `null` when:
 *   - the runtime is older than the schema (no `split_kind` data)
 *   - every served model is `solo` or `cold` (nothing notable to mention)
 */
export function MeshAwareNote() {
  const { models, loading, online } = useMeshModels();
  if (loading || !online) return null;

  const splits = models.filter(
    (m) =>
      m.status === "warm" &&
      (m.splitKind === "pipeline" || m.splitKind === "moe"),
  );
  if (splits.length === 0) return null;

  // Surface up to 2 splits in the message to stay readable.
  const lead = splits[0];
  const extra = splits.length - 1;

  const noun = lead.splitKind === "pipeline" ? "pipeline-split" : "MoE-sharded";

  return (
    <div className="rounded-xl border border-sky-400/30 bg-sky-400/5 px-4 py-2.5 text-[12px] text-sky-300/90">
      <span className="text-sky-200">{lead.displayName || lead.name}</span> is
      currently {noun} across {lead.nodeCount} contributors pooling{" "}
      {lead.meshVramGb.toFixed(1)} GB
      {extra > 0 ? `, plus ${extra} more split ${extra === 1 ? "model" : "models"}` : ""}
      . Responses come from the swarm, not a single machine.
    </div>
  );
}
