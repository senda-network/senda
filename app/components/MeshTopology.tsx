"use client";

import type { MeshModel, NodeSummary } from "../lib/use-mesh-status";

/**
 * Per-model topology diagram. For each model the runtime reports as actively
 * split (`split_kind ∈ {pipeline, moe}`), draws a small SVG showing the host
 * node centered with worker spokes labeled by hostname.
 *
 * Solo and multi_host models are intentionally NOT drawn — solo deserves no
 * diagram and multi_host is just N independent copies, which is better
 * communicated by a list. The component is null when nothing is split.
 *
 * For older runtimes that don't emit `split_kind`, we render based on a
 * fallback heuristic: a `node_count > 1` model is considered split. The UI
 * may be imprecise on legacy meshes — that's an accepted cost of supporting
 * the 6-hour auto-update lag.
 */
export function MeshTopology({
  models,
  nodes,
}: {
  models: MeshModel[];
  nodes: NodeSummary[];
}) {
  const splits = models.filter((m) => isSplitDisplayable(m));

  if (splits.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)]">
      <div className="border-b border-[var(--border)] px-5 py-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">
          Active splits
        </div>
        <div className="text-sm font-semibold tracking-tight text-[var(--fg)]">
          {splits.length === 1
            ? "1 model running across the mesh"
            : `${splits.length} models running across the mesh`}
        </div>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {splits.map((model) => (
          <SplitDiagram key={model.name} model={model} nodes={nodes} />
        ))}
      </ul>
    </section>
  );
}

function isSplitDisplayable(model: MeshModel): boolean {
  if (model.splitKind === "pipeline" || model.splitKind === "moe") return true;
  // Legacy runtime fallback: if the runtime didn't emit split_kind but the
  // model is being served by multiple nodes, draw it conservatively.
  if (
    !["solo", "multi_host", "cold"].includes(model.splitKind) &&
    model.nodeCount > 1
  )
    return true;
  return false;
}

function SplitDiagram({
  model,
  nodes,
}: {
  model: MeshModel;
  nodes: NodeSummary[];
}) {
  const isPipeline = model.splitKind === "pipeline";
  const isMoe = model.splitKind === "moe";

  // Find the elected host (if any node reports a splitGroup for this model).
  const hostNode = nodes.find(
    (n) => n.splitGroup?.model === model.name && n.splitRole === "pipeline_host",
  );
  // Worker peers are the remainder of the group (or, fallback, anyone whose
  // serving_models list contains the model and isn't the host).
  const workerNodes = nodes
    .filter(
      (n) =>
        n.id !== hostNode?.id &&
        (n.splitGroup?.model === model.name ||
          n.servingModels.includes(model.name)),
    )
    .slice(0, 7); // cap visual fan-out

  const totalParticipants = (hostNode ? 1 : 0) + workerNodes.length;
  const labelText = isPipeline
    ? `Pipeline split · ${totalParticipants || model.nodeCount} contributors pooling ${model.meshVramGb.toFixed(1)} GB`
    : isMoe
      ? `MoE shards · ${model.nodeCount} contributors`
      : `Multi-node serve · ${model.nodeCount} contributors`;

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12px] text-[var(--fg)]">
          {model.displayName || model.name}
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
          {labelText}
        </div>
        <div className="mt-1 text-[10px] text-[var(--fg-muted)]">
          {model.sizeGb.toFixed(1)} GB model · {modelCharacterization(model)}
        </div>
      </div>
      <Spokes
        host={hostNode ?? null}
        workers={workerNodes}
        kind={isPipeline ? "pipeline" : "moe"}
      />
    </li>
  );
}

function modelCharacterization(model: MeshModel): string {
  if (model.splitKind === "pipeline") {
    return "layer-split via RPC across contributors";
  }
  if (model.splitKind === "moe") {
    return `MoE expert sharding${
      model.expertCount ? ` · ${model.expertCount} experts total` : ""
    }`;
  }
  return "multi-node deployment";
}

function Spokes({
  host,
  workers,
  kind,
}: {
  host: NodeSummary | null;
  workers: NodeSummary[];
  kind: "pipeline" | "moe";
}) {
  const width = 220;
  const height = 96;
  const cx = width / 2;
  const cy = height / 2;
  const hostRadius = 14;
  const workerRadius = 8;
  const spread = workers.length === 0 ? 0 : Math.min(workers.length, 6);
  const arcStart = -Math.PI / 2 - Math.PI / 3;
  const arcEnd = -Math.PI / 2 + Math.PI / 3;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Topology of ${kind} split`}
      className="shrink-0"
    >
      {/* Spoke lines */}
      {workers.map((w, i) => {
        const t =
          spread === 1 ? 0.5 : i / Math.max(1, spread - 1 + (workers.length - spread));
        const angle = arcStart + (arcEnd - arcStart) * t;
        const wx = cx + Math.cos(angle) * 70;
        const wy = cy + Math.sin(angle) * 36;
        return (
          <line
            key={`spoke-${w.id}`}
            x1={cx}
            y1={cy}
            x2={wx}
            y2={wy}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        );
      })}

      {/* Host node — solid filled circle */}
      <circle
        cx={cx}
        cy={cy}
        r={hostRadius}
        fill="currentColor"
        opacity={0.85}
      />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        fontSize="10"
        fill="var(--bg)"
        fontWeight={600}
      >
        {kind === "pipeline" ? "H" : "M"}
      </text>

      {/* Worker / shard nodes — outline circles */}
      {workers.map((w, i) => {
        const t =
          spread === 1 ? 0.5 : i / Math.max(1, spread - 1 + (workers.length - spread));
        const angle = arcStart + (arcEnd - arcStart) * t;
        const wx = cx + Math.cos(angle) * 70;
        const wy = cy + Math.sin(angle) * 36;
        return (
          <g key={`node-${w.id}`}>
            <circle
              cx={wx}
              cy={wy}
              r={workerRadius}
              fill="var(--bg-elev)"
              stroke="currentColor"
              strokeOpacity={0.7}
              strokeWidth={1.2}
            />
            {w.isSelf && (
              <circle
                cx={wx}
                cy={wy}
                r={workerRadius + 3}
                fill="none"
                stroke="var(--accent)"
                strokeOpacity={0.9}
                strokeWidth={1.5}
              />
            )}
          </g>
        );
      })}

      {/* Host self-marker if local node is the host */}
      {host?.isSelf && (
        <circle
          cx={cx}
          cy={cy}
          r={hostRadius + 4}
          fill="none"
          stroke="var(--accent)"
          strokeOpacity={0.9}
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
}
