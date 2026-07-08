"use client";

import type { NodeSummary } from "../lib/use-mesh-status";
import type { MeshModel } from "../lib/use-mesh-status";

/**
 * Big-numbers header for the Mesh page. Surfaces the live marketplace
 * shape — contributor count, aggregate hosting capacity, models served,
 * and how many of those are running as multi-node splits — without
 * promoting the "one collective computer / one virtual GPU" framing the
 * strategy explicitly demotes (see `internal/STRATEGY.md` §2: each peer
 * serves what fits end-to-end; pooled splits are a power-user fallback,
 * not the headline). The prose subheader leads with per-peer serving;
 * splits are kept as a stat for transparency but called out as a
 * power-user mode.
 *
 * Driven by the live `useMeshStatus()` and `useMeshModels()` outputs. The
 * model-list input is optional so this component can render meaningfully on
 * older runtimes (<0.66) that don't emit `mesh_models` topology data — in
 * that case the "splits active" stat is omitted rather than zeroed (which
 * would be misleading for older meshes that may actually have splits).
 */
export function MeshComputer({
  nodes,
  models,
}: {
  nodes: NodeSummary[];
  models: MeshModel[];
}) {
  // Filter out entry nodes (hostname starts with "ip-") for the contributor
  // count — the gateway is infrastructure, not a participating Mac. Same
  // rationale as the public Mesh page.
  const contributors = nodes.filter(
    (n) => !(n.hostname ?? "").startsWith("ip-"),
  );
  const contributorCount = contributors.length;
  // Pool VRAM only across contributor nodes for the same reason: the entry's
  // 0 GB shouldn't drag the headline number down, and the entry's reported
  // VRAM (if any) belongs to the cloud gateway, not the user's swarm.
  const pooledVramGb = contributors.reduce(
    (acc, n) => acc + (n.capability.vramGb || n.vramGb || 0),
    0,
  );

  // Models actually being served right now. Falls back to a union of every
  // contributor's `servingModels` when the model inventory hasn't loaded
  // yet — keeps the headline non-zero on cold starts.
  const warmModels = models.filter((m) => m.status === "warm");
  const modelCount =
    warmModels.length > 0
      ? warmModels.length
      : new Set(contributors.flatMap((n) => n.servingModels)).size;

  // Active splits = models the runtime classifies as not solo and not cold.
  // Old runtimes won't emit split_kind; we only show this stat when the
  // models hook has data so we don't claim "0 splits" against an unknown
  // mesh.
  const splitsActive = warmModels.filter(
    (m) => m.splitKind === "pipeline" || m.splitKind === "moe",
  ).length;
  const showSplitsStat = warmModels.length > 0;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--bg-elev)] to-[var(--bg-elev-2)] p-5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">
        Senda, right now
      </div>
      <div className="mt-2 text-[15px] leading-snug text-[var(--fg)]">
        <span className="text-2xl font-semibold tracking-tight">
          {contributorCount}
        </span>{" "}
        {contributorCount === 1 ? "contributor" : "contributors"} hosting{" "}
        <span className="text-2xl font-semibold tracking-tight">
          {pooledVramGb >= 100
            ? `${Math.round(pooledVramGb)} GB`
            : `${pooledVramGb.toFixed(1)} GB`}
        </span>{" "}
        of aggregate capacity
      </div>
      <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--fg-muted)]">
        Each contributor hosts what fits on their hardware end-to-end — the
        mesh routes each session to the best peer for the job. Models too
        big for any single peer can fall back to a pooled split: a
        power-user mode for the rare case the catalog can&apos;t otherwise
        serve.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Contributors" value={String(contributorCount)} />
        <Stat
          label="Pooled memory"
          value={
            pooledVramGb >= 100
              ? `${Math.round(pooledVramGb)} GB`
              : `${pooledVramGb.toFixed(1)} GB`
          }
        />
        <Stat label="Models served" value={String(modelCount)} />
        {showSplitsStat ? (
          <Stat
            label="Splits active"
            value={String(splitsActive)}
            hint={
              splitsActive > 0
                ? "Models running in power-user pooled mode (no single peer can solo them)"
                : "No models are in pooled split mode right now"
            }
          />
        ) : (
          <Stat
            label="Splits active"
            value="—"
            hint="Reporting needs runtime ≥0.66"
          />
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2.5"
      title={hint}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--fg-muted)]">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--fg)]">
        {value}
      </div>
    </div>
  );
}
