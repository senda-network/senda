"use client";

import { useEffect, useState } from "react";

type StatusNode = {
  hostname?: string | null;
  vramGb?: number;
  state?: string;
  servingModels?: string[];
  capability?: { vramGb?: number };
};

type Status = {
  online: boolean;
  models: string[];
  nodeCount?: number;
  nodes?: StatusNode[];
};

type Stats = {
  online: boolean;
  contributorCount: number;
  servingCount: number;
  pooledVramGb: number;
  modelCount: number;
};

const DEFAULT_STATS: Stats = {
  online: false,
  contributorCount: 0,
  servingCount: 0,
  pooledVramGb: 0,
  modelCount: 0,
};

/**
 * Live "ClosedMesh, right now" stats strip used on about / landing pages.
 * Replaces the static "no third-party API" pills with running numbers
 * pulled from the public mesh entry node — pooled memory, contributor
 * count, and how many models are live. Reframes the marketing surface
 * around the swarm rather than around the desktop app.
 *
 * Polls every 30s (matching `MeshLiveStatus`) and degrades silently to a
 * "Mesh status loading" hint if the entry is unreachable. We never want
 * the hero to flash a broken-looking "0 contributors" — too easy to
 * misread on first visit.
 */
export function MeshLiveStats() {
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [phase, setPhase] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Status;
        if (cancelled) return;
        if (data.online) {
          const contributors = (data.nodes ?? []).filter(
            (n) => !(n.hostname ?? "").startsWith("ip-"),
          );
          const servingCount = contributors.filter(
            (n) =>
              n.state === "serving" ||
              (n.servingModels != null && n.servingModels.length > 0),
          ).length;
          const pooledVramGb = contributors.reduce(
            (acc, n) => acc + (n.capability?.vramGb ?? n.vramGb ?? 0),
            0,
          );
          setStats({
            online: true,
            contributorCount: contributors.length,
            servingCount,
            pooledVramGb,
            modelCount: (data.models ?? []).length,
          });
          setPhase("ok");
        } else {
          setStats(DEFAULT_STATS);
          setPhase("error");
        }
      } catch {
        if (!cancelled) {
          setStats(DEFAULT_STATS);
          setPhase("error");
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(tick, 30_000);
        }
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (phase === "loading") {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] px-5 py-4 text-[12px] text-[var(--fg-muted)]">
        Reading the mesh…
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] px-5 py-4 text-[12px] text-[var(--fg-muted)]">
        The mesh is currently unreachable.
      </div>
    );
  }

  const vramLabel =
    stats.pooledVramGb >= 100
      ? `${Math.round(stats.pooledVramGb)} GB`
      : `${stats.pooledVramGb.toFixed(1)} GB`;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
        ClosedMesh, right now
      </div>
      <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat value={String(stats.servingCount)} label="serving now" />
        <Stat
          value={String(stats.contributorCount)}
          label={
            stats.contributorCount === 1
              ? "contributor online"
              : "contributors online"
          }
        />
        <Stat
          value={String(stats.modelCount)}
          label={stats.modelCount === 1 ? "model live" : "models live"}
        />
        <Stat
          value={vramLabel}
          label="pooled memory"
        />
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight text-[var(--fg)]">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-[var(--fg-muted)]">{label}</div>
    </div>
  );
}
