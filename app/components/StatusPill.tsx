"use client";

import { useState } from "react";
import { useMeshStatus, type NodeSummary } from "../lib/use-mesh-status";

const BACKEND_LABEL: Record<string, string> = {
  metal: "Metal",
  cuda: "CUDA",
  rocm: "ROCm",
  vulkan: "Vulkan",
  cpu: "CPU",
};

const VENDOR_LABEL: Record<string, string> = {
  apple: "Apple",
  nvidia: "NVIDIA",
  amd: "AMD",
  intel: "Intel",
  none: "—",
};

function formatBackend(b: string): string {
  return BACKEND_LABEL[b] ?? b;
}

function formatVendor(v: string): string {
  return VENDOR_LABEL[v] ?? v;
}

function backendBadgeColor(backend: string): string {
  switch (backend) {
    case "metal":
      return "bg-amber-400/20 text-amber-300 border-amber-400/40";
    case "cuda":
      return "bg-emerald-400/20 text-emerald-300 border-emerald-400/40";
    case "rocm":
      return "bg-rose-400/20 text-rose-300 border-rose-400/40";
    case "vulkan":
      return "bg-sky-400/20 text-sky-300 border-sky-400/40";
    case "cpu":
      return "bg-zinc-400/20 text-zinc-300 border-zinc-400/40";
    default:
      return "bg-zinc-400/20 text-zinc-300 border-zinc-400/40";
  }
}

function NodeRow({
  node,
  latestVersion,
}: {
  node: NodeSummary;
  /** Highest runtime version observed across the mesh in this snapshot.
   * Used to flag peers running an older build with a small "outdated"
   * pill, matching the same affordance on the public /status page so the
   * desktop app and the website never disagree about who's behind. */
  latestVersion: string | null;
}) {
  const cap = node.capability;
  const subtitle = [formatVendor(cap.vendor), `${cap.vramGb || node.vramGb} GB`]
    .filter(Boolean)
    .join(" · ");
  // "outdated" only fires when we both have a peer-reported version AND a
  // mesh-wide max to compare against. compareVersions returns negative
  // when this node's version is lower than `latestVersion`. We never
  // flag a peer outdated just because its version is null (older
  // runtimes that don't report version simply get no chip).
  const isOutdated =
    node.version !== null &&
    latestVersion !== null &&
    compareVersions(node.version, latestVersion) < 0;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] py-2 last:border-b-0 last:pb-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[var(--fg)]">
            {node.hostname ?? node.id.slice(0, 8)}
          </span>
          {node.isSelf && (
            <span className="text-[9px] uppercase tracking-wider text-[var(--fg-muted)]">
              you
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-[var(--fg-muted)]">
          {subtitle}
        </div>
        {node.version && (
          <div
            className={
              "mt-0.5 font-mono text-[10px] " +
              (isOutdated ? "text-amber-300" : "text-[var(--fg-muted)]")
            }
            title={
              isOutdated && latestVersion
                ? `Running v${node.version}. Latest seen in this mesh is v${latestVersion}. The desktop app auto-upgrades the runtime within ~6 hours of launch, so this should self-heal soon.`
                : `Runtime v${node.version}`
            }
          >
            runtime v{node.version}
            {isOutdated ? " · outdated" : ""}
          </div>
        )}
        {node.servingModels.length > 0 && (
          <div className="mt-1 truncate font-mono text-[10px] text-[var(--fg-muted)]">
            {node.servingModels.join(", ")}
          </div>
        )}
      </div>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${backendBadgeColor(
          cap.backend,
        )}`}
        title={`${formatBackend(cap.backend)} · ${cap.computeClass}`}
      >
        {formatBackend(cap.backend)}
      </span>
    </div>
  );
}

/**
 * Three-way semver compare on the major.minor.patch triplet, tolerant of
 * `-rc1` / `-beta.2` suffixes (everything after the first non-digit in a
 * segment is dropped). Returns negative if `a < b`, 0 if equal, positive
 * if `a > b`. We intentionally don't import a semver lib for this — the
 * dropdown is rendered every 8 s while the menu is open, and dragging
 * in `semver` for three numeric compares would bloat the controller
 * sidecar bundle. Mirrors `compareVersions` in `app/(public)/status/page.tsx`.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .split(".")
      .slice(0, 3)
      .map((s) => parseInt(s.replace(/[^0-9].*$/, ""), 10) || 0);
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) {
    const av = A[i] ?? 0;
    const bv = B[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** Highest runtime version observed across the supplied nodes. Returns
 *  null when no peer is reporting a version (older runtimes only). */
function maxVersion(nodes: NodeSummary[]): string | null {
  let best: string | null = null;
  for (const n of nodes) {
    if (!n.version) continue;
    if (!best || compareVersions(n.version, best) > 0) best = n.version;
  }
  return best;
}

/** Drop entry-node-shaped peers; same rationale as on the Mesh page. */
function isContributor(n: NodeSummary): boolean {
  return !(n.hostname ?? "").startsWith("ip-");
}

export function StatusPill() {
  const status = useMeshStatus();
  const [hover, setHover] = useState(false);
  const contributors = status.nodes.filter(isContributor);
  const contributorCount = contributors.length || status.nodeCount;
  const pooledVramGb = contributors.reduce(
    (acc, n) => acc + (n.capability.vramGb || n.vramGb || 0),
    0,
  );
  const dotColor = status.online ? "bg-emerald-400" : "bg-zinc-500";
  // Lead with "contributors" (the swarm framing) instead of "machines".
  // Pooled VRAM is the second number people care about — it answers
  // "how big a model can the mesh run?" at a glance.
  const label = !status.online
    ? "Not running"
    : pooledVramGb > 0
      ? `${contributorCount} ${contributorCount === 1 ? "contributor" : "contributors"} · ${pooledVramGb >= 100 ? Math.round(pooledVramGb) : pooledVramGb.toFixed(1)} GB pooled`
      : `${contributorCount} ${contributorCount === 1 ? "contributor" : "contributors"}`;
  const model = status.models[0];
  const showPanel = hover && status.online && status.nodes.length > 0;

  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1.5 text-[11px] text-[var(--fg-muted)]">
        <span
          className={`relative inline-block h-1.5 w-1.5 rounded-full ${dotColor}`}
        >
          {status.online && (
            <span className="absolute inset-0 rounded-full bg-emerald-400 pulse-soft" />
          )}
        </span>
        <span className="font-medium text-[var(--fg)]">{label}</span>
        {model && (
          <>
            <span className="opacity-40">·</span>
            <span className="font-mono text-[10px] tracking-tight">
              {model}
            </span>
          </>
        )}
      </div>
      {showPanel && (
        <div
          role="tooltip"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-[11px] shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
            <span>Contributors</span>
            <span>{status.nodes.length}</span>
          </div>
          {(() => {
            // Compute the mesh-wide "latest" once per render and pass it
            // into every row so we don't recompute the max on every NodeRow
            // mount — and so peers can't disagree about whether the same
            // version is "outdated" mid-list.
            const latest = maxVersion(status.nodes);
            return status.nodes.map((n) => (
              <NodeRow key={n.id} node={n} latestVersion={latest} />
            ));
          })()}
        </div>
      )}
    </div>
  );
}
