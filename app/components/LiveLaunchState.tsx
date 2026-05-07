"use client";

import { loadedModelUnderprovisioning } from "../lib/mesh-fit";
import type { MeshModel } from "../lib/use-mesh-status";

/**
 * One-line "what's the runtime actually doing with this model right now"
 * indicator. Mirrors the launch planner's three-state output (Solo / Split /
 * WaitingForCapacity) plus the MoE / multi-host variants the runtime can
 * report for already-warm models.
 *
 * Intentionally compact and text-only: the dashboard already has the model
 * name as a pill above this; this line just answers the next question the
 * user is going to ask, which is "is it actually serving, and across how
 * many machines?"
 *
 * Renders nothing when there's not enough information to say anything
 * useful (no mesh-models data, model not configured, etc.) — callers can
 * always render this and let it self-hide.
 */
export function LiveLaunchState({
  meshModel,
  isLoaded,
  isConfigured,
  selfHostname,
  variant = "inline",
}: {
  /** Runtime's per-model topology snapshot. Null if the runtime hasn't
   * surfaced this model yet (typical during the first few seconds after
   * setting a startup config, before the mesh planner has run). */
  meshModel: MeshModel | null;
  /** True iff the model name appears in `loaded_models` for the local node
   * — i.e. llama-server has finished mmaping the GGUF and reports ready. */
  isLoaded: boolean;
  /** True iff the model is in the user's `[[models]]` startup config. Used
   * to surface "we're trying but waiting for capacity" instead of just
   * "cold" for catalog-only models. */
  isConfigured: boolean;
  /** Local hostname so we can say "Solo on MacBook-Air-de-al-2" rather
   * than just "Solo". Falls back to "this Mac" when null. */
  selfHostname: string | null;
  /** `inline` is a single muted-text line; `card` is a slightly larger
   * pill suitable for the dashboard's loaded-model card. */
  variant?: "inline" | "card";
}) {
  const palette = paletteFor(variant);

  if (isLoaded) {
    // The runtime reports this model as loaded, but the planner may
    // have classified it as `cold` — its signal that the host's
    // memory budget falls short of what the model needs to serve at
    // useful speed, even though llama-server will accept the model.
    // Treat that as the same "awaiting capacity" amber state we use
    // for WaitingForCapacity rather than the green "ok" we show for
    // true solo / split / multi-host placements. Source helper in
    // app/lib/mesh-fit.ts.
    const under = loadedModelUnderprovisioning(meshModel);
    if (under) {
      return (
        <span className={palette.waiting}>
          Awaiting capacity · needs ~{under.needGb.toFixed(0)} GB pooled
          memory, this mesh offers {under.haveGb.toFixed(0)} GB ·{" "}
          <span className="font-semibold">
            pool {Math.ceil(under.shortfallGb)} GB more to bring online
          </span>
        </span>
      );
    }
    return (
      <span className={palette.ok}>{loadedLabel(meshModel, selfHostname)}</span>
    );
  }

  if (!isConfigured) return null;

  if (!meshModel) {
    return <span className={palette.pending}>Loading…</span>;
  }

  const fit = meshModel.meshFit;

  // Configured but not yet loaded. Three sub-cases driven by the live
  // mesh_fit numbers (NOT the catalog estimate — these come from the
  // runtime's planner against actual peer VRAM, same-backend filtering,
  // and RTT eligibility).
  if (fit.fitsOnLargestNode || fit.fitsPooled) {
    // Mesh has the headroom; runtime just hasn't finished mmap'ing the
    // GGUF. Likely transient.
    if (fit.fitsPooled && !fit.fitsOnLargestNode) {
      return (
        <span className={palette.pending}>
          Loading across the mesh — pooling {fit.pooledVramGb.toFixed(0)} GB
          across {fit.eligiblePeerCount}{" "}
          {fit.eligiblePeerCount === 1 ? "peer" : "peers"}…
        </span>
      );
    }
    return <span className={palette.pending}>Loading…</span>;
  }

  // The interesting case: WaitingForCapacity. The planner has parked
  // itself because no one machine fits the model and the pooled total
  // is also short. Show the exact gap so the user knows what to ask
  // their next contributor for.
  const shortfall = Math.max(0, fit.neededVramGb - fit.pooledVramGb);
  return (
    <span className={palette.waiting}>
      Waiting for capacity — pooled {fit.pooledVramGb.toFixed(1)} of{" "}
      {fit.neededVramGb.toFixed(1)} GB ·{" "}
      <span className="font-semibold">need {shortfall.toFixed(0)} GB more</span>
      {fit.eligiblePeerCount === 1 && " (just this machine so far)"}
    </span>
  );
}

function loadedLabel(model: MeshModel | null, selfHostname: string | null): string {
  const here = selfHostname ?? "this Mac";
  if (!model) return `Solo · ${here}`;

  switch (model.splitKind) {
    case "pipeline": {
      const peers = Math.max(model.activeNodes.length, model.nodeCount, 1);
      return `Split across ${peers} ${peers === 1 ? "node" : "nodes"} · pooling ${model.meshVramGb.toFixed(0)} GB`;
    }
    case "moe": {
      const shards = Math.max(model.activeNodes.length, model.nodeCount, 1);
      return `MoE · ${shards} shard ${shards === 1 ? "node" : "nodes"}`;
    }
    case "multi_host":
      return `Replicated across ${Math.max(model.nodeCount, 2)} nodes`;
    case "solo":
      return `Solo · ${here}`;
    case "cold":
    default:
      // Reaching the cold branch here means the mesh-fit shortfall was
      // below the underprovisioning threshold (otherwise the caller
      // returned the loud amber message). That's almost always the
      // brief window after llama-server flips ready and before the
      // planner reclassifies — say so plainly rather than the old
      // "slow until you add a peer" line, which sugar-coated the real
      // mmap-thrash case and confused users on under-spec hosts who
      // were watching every chat request hang.
      return `Solo · ${here} · warming up`;
  }
}

function paletteFor(variant: "inline" | "card") {
  if (variant === "card") {
    return {
      ok: "rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300",
      pending:
        "rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300",
      waiting:
        "rounded-full border border-amber-400/40 bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-200",
    };
  }
  return {
    ok: "text-[11px] text-emerald-300/85",
    pending: "text-[11px] text-amber-300/85",
    waiting: "text-[11px] text-amber-200/95",
  };
}
