"use client";

import { PageHeader } from "../../components/PageHeader";
import { RemoteInstall } from "../../components/RemoteInstall";
import { MeshComputer } from "../../components/MeshComputer";
import { MeshTopology } from "../../components/MeshTopology";
import {
  useMeshStatus,
  type NodeSummary,
  type MeshModel,
  type SplitRole,
} from "../../lib/use-mesh-status";
import { useMeshModels } from "../../lib/use-mesh-models";
import { nodeDisplayState } from "../../lib/node-display-state";

const BACKEND_LABEL: Record<string, string> = {
  metal: "Apple Metal",
  cuda: "NVIDIA CUDA",
  rocm: "AMD ROCm",
  vulkan: "Vulkan",
  cpu: "CPU",
};

export default function NodesPage() {
  const mesh = useMeshStatus();
  const meshModels = useMeshModels();

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Mesh"
        subtitle="One collective computer made of every contributor."
      />

      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
          {!mesh.loading && mesh.online && (
            <MeshComputer nodes={mesh.nodes} models={meshModels.models} />
          )}

          <MeshTopology models={meshModels.models} nodes={mesh.nodes} />

          <NodesTable
            nodes={mesh.nodes}
            loading={mesh.loading}
            online={mesh.online}
          />

          {meshModels.models.length > 0 && (
            <ModelsServedSection models={meshModels.models} />
          )}

          <AddMachine />
        </div>
      </main>
    </div>
  );
}

/**
 * Adding a remote machine over SSH is a power-user flow — it shouldn't sit at
 * the top of the overview. Tuck it into a quiet disclosure so the page reads as
 * "here's your mesh" first, with "grow it" available on demand.
 */
function AddMachine() {
  return (
    <details className="group overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--border)] bg-[var(--bg-elev)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
            Advanced
          </div>
          <div className="text-sm font-semibold tracking-tight text-[var(--fg)]">
            Add a machine
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--fg-muted)]">
            Install the runtime on another computer over SSH and join it to your
            mesh.
          </div>
        </div>
        <span
          aria-hidden
          className="shrink-0 text-[var(--fg-muted)] transition group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="border-t border-[var(--border)] px-5 py-4">
        <RemoteInstall />
      </div>
    </details>
  );
}

function NodesTable({
  nodes,
  loading,
  online,
}: {
  nodes: NodeSummary[];
  loading: boolean;
  online: boolean;
}) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-8 text-center text-sm text-[var(--fg-muted)]">
        Loading mesh…
      </section>
    );
  }
  if (!online || nodes.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-elev)]/50 p-10 text-center">
        <div className="text-base font-semibold tracking-tight text-[var(--fg)]">
          No machines connected yet
        </div>
        <div className="mx-auto mt-1.5 max-w-md text-sm text-[var(--fg-muted)]">
          This machine should join automatically — if it&apos;s offline, use
          Join mesh in the top bar, or add another machine under Advanced.
        </div>
      </section>
    );
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)]">
      <div className="border-b border-[var(--border)] px-5 py-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">
          Connected machines
        </div>
        <div className="text-sm font-semibold tracking-tight text-[var(--fg)]">
          {nodes.length} {nodes.length === 1 ? "machine" : "machines"} online
        </div>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {nodes.map((n) => (
          <NodeRow key={n.id} node={n} />
        ))}
      </ul>
    </section>
  );
}

function NodeRow({ node }: { node: NodeSummary }) {
  const isEntry = node.hostname?.startsWith("ip-") ?? false;
  const cap = node.capability;
  const backend = BACKEND_LABEL[cap.backend] ?? cap.backend;
  const vram = cap.vramGb || node.vramGb;
  const models = node.servingModels;
  const display = nodeDisplayState(node);
  const stateLabel = display.label;
  const stateColor = display.badge;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-[var(--fg)]">
            {isEntry ? "Entry node" : (node.hostname ?? node.id.slice(0, 10))}
          </span>
          {node.isSelf && (
            <span className="rounded-full border border-[var(--border)] bg-[var(--bg-elev-2)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--fg-muted)]">
              this Mac
            </span>
          )}
          <SplitRoleBadge node={node} />
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
          {isEntry
            ? "entry.senda.network · always-on gateway"
            : `${backend} · ${vram ? `${vram.toFixed(1)} GB memory` : "memory unknown"}`}
          {node.version && (
            <span className="ml-2 font-mono text-[10px] tabular-nums">
              · v{node.version}
            </span>
          )}
        </div>
        <SplitRoleDetail node={node} />
        {!isEntry && models.length > 0 && (
          <div className="mt-1 truncate font-mono text-[10px] text-[var(--fg-muted)]">
            {models.join(", ")}
          </div>
        )}
      </div>
      <span
        className={
          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium " +
          stateColor
        }
      >
        {stateLabel}
      </span>
    </li>
  );
}

function SplitRoleBadge({ node }: { node: NodeSummary }) {
  const role = node.splitRole;
  if (!role) return null;
  const cls = roleBadgeClasses(role);
  return (
    <span
      className={
        "rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider " +
        cls
      }
    >
      {roleBadgeLabel(role)}
    </span>
  );
}

function SplitRoleDetail({ node }: { node: NodeSummary }) {
  const role = node.splitRole;
  if (!role) return null;

  if (role === "pipeline_host" && node.splitGroup) {
    const peerCount = node.splitGroup.peerIds.length;
    return (
      <div className="mt-1 text-[11px] text-[var(--fg-muted)]">
        Pipeline host of{" "}
        <span className="font-mono text-[var(--fg)]">
          {node.splitGroup.model}
        </span>
        {" — "}
        coordinating {peerCount > 1 ? `${peerCount - 1} layer workers` : "the split"}{" "}
        ({node.splitGroup.totalGroupVramGb.toFixed(1)} GB pooled)
      </div>
    );
  }

  if (role === "pipeline_worker" && node.splitGroup) {
    return (
      <div className="mt-1 text-[11px] text-[var(--fg-muted)]">
        Layer worker for{" "}
        <span className="font-mono text-[var(--fg)]">
          {node.splitGroup.model}
        </span>
      </div>
    );
  }

  if (role === "moe_shard" && node.moeShard) {
    return (
      <div className="mt-1 text-[11px] text-[var(--fg-muted)]">
        MoE shard of{" "}
        <span className="font-mono text-[var(--fg)]">{node.moeShard.model}</span>
        {" — "}
        {node.moeShard.totalShards > 1
          ? `${node.moeShard.totalShards} shards across the mesh`
          : "single shard"}
      </div>
    );
  }

  return null;
}

function roleBadgeLabel(role: NonNullable<SplitRole>): string {
  switch (role) {
    case "pipeline_host":
      return "Hosting a split";
    case "pipeline_worker":
      return "Helping a split";
    case "moe_shard":
      return "Serving a shard";
  }
}

function roleBadgeClasses(role: NonNullable<SplitRole>): string {
  switch (role) {
    case "pipeline_host":
      return "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]";
    case "pipeline_worker":
      return "border-[var(--info)]/30 bg-[var(--info-soft)] text-[var(--info)]";
    case "moe_shard":
      return "border-[var(--info)]/30 bg-[var(--info-soft)] text-[var(--info)]";
  }
}

function ModelsServedSection({ models }: { models: MeshModel[] }) {
  // Show warm models prominently; cold/catalog models are covered on the
  // Models page so we keep this section a tight "what's running right now"
  // strip.
  const warm = models.filter((m) => m.status === "warm");
  if (warm.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)]">
      <div className="border-b border-[var(--border)] px-5 py-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">
          Models the mesh is serving right now
        </div>
        <div className="text-sm font-semibold tracking-tight text-[var(--fg)]">
          {warm.length} {warm.length === 1 ? "model" : "models"} live
        </div>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {warm.map((m) => (
          <li
            key={m.name}
            className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[12px] text-[var(--fg)]">
                {m.displayName || m.name}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
                {modelTopologyLine(m)}
              </div>
            </div>
            <span
              className={
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium " +
                splitKindBadgeClasses(m.splitKind)
              }
            >
              {splitKindLabel(m.splitKind)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function modelTopologyLine(model: MeshModel): string {
  const size = `${model.sizeGb.toFixed(1)} GB model`;
  const pool = `${model.meshVramGb.toFixed(1)} GB pooled`;
  if (model.splitKind === "solo") {
    return `${size} · served solo by 1 node`;
  }
  if (model.splitKind === "pipeline") {
    return `${size} · split across ${model.nodeCount} nodes (${pool})`;
  }
  if (model.splitKind === "moe") {
    return `${size} · ${model.nodeCount} MoE shards${
      model.expertCount ? ` · ${model.expertCount} experts` : ""
    }`;
  }
  if (model.splitKind === "multi_host") {
    return `${size} · ${model.nodeCount} redundant copies`;
  }
  return `${size} · ${model.nodeCount} ${
    model.nodeCount === 1 ? "node" : "nodes"
  }`;
}

function splitKindLabel(kind: MeshModel["splitKind"]): string {
  switch (kind) {
    case "solo":
      return "Solo";
    case "pipeline":
      return "Pipeline";
    case "moe":
      return "MoE";
    case "multi_host":
      return "Multi-host";
    case "cold":
      return "Cold";
  }
}

function splitKindBadgeClasses(kind: MeshModel["splitKind"]): string {
  switch (kind) {
    case "solo":
      return "border-[var(--border)] bg-[var(--bg-elev-2)] text-[var(--fg-muted)]";
    case "pipeline":
      return "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]";
    case "moe":
      return "border-[var(--info)]/30 bg-[var(--info-soft)] text-[var(--info)]";
    case "multi_host":
      return "border-[var(--info)]/30 bg-[var(--info-soft)] text-[var(--info)]";
    case "cold":
      return "border-[var(--border)] bg-[var(--bg-elev-2)] text-[var(--fg-muted)]";
  }
}
