"use client";

import { useEffect, useState } from "react";

type LeaderboardRow = {
  peerId: string;
  credits: number;
};

/**
 * Public credits leaderboard for early-access contributors.
 * Polls /api/credits every 60s.
 */
export function CreditsLeaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [storeReady, setStoreReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      try {
        const res = await fetch("/api/credits?limit=10", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          storeReady: boolean;
          leaderboard: LeaderboardRow[];
        };
        if (cancelled) return;
        setStoreReady(data.storeReady);
        setRows(data.leaderboard ?? []);
      } catch {
        if (!cancelled) {
          setStoreReady(false);
          setRows([]);
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, 60_000);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (storeReady === null) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 text-[12px] text-[var(--fg-muted)]">
        Loading credits leaderboard…
      </div>
    );
  }

  if (!storeReady) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 text-[12px] text-[var(--fg-muted)]">
        Credits ledger activates when Redis is configured on production.
        Local dashboard still shows your machine&apos;s served-token tally.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 text-[12px] text-[var(--fg-muted)]">
        No mesh credits recorded yet — serve a chat request to appear here.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      <div className="border-b border-[var(--border)] bg-[var(--bg-elev)] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
        Credits leaderboard (early access)
      </div>
      <ol className="divide-y divide-[var(--border)]">
        {rows.map((row, i) => (
          <li
            key={row.peerId}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-5 shrink-0 font-mono text-[11px] text-[var(--fg-muted)]">
                {i + 1}
              </span>
              <span className="truncate font-mono text-[12px] text-[var(--fg)]">
                {row.peerId}
              </span>
            </div>
            <span className="shrink-0 font-mono text-[12px] text-[var(--accent)]">
              {row.credits.toLocaleString()} cr
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
