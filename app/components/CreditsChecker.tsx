"use client";

import { useState } from "react";

type PeerCredits = {
  peerId: string;
  credits: number;
  usd: number;
  tokensByModel: Record<string, number>;
};

/**
 * Self-serve credit lookup for contributors not on the top-10 leaderboard.
 * Operators find their short node id on /status and paste it here.
 */
export function CreditsChecker() {
  const [peerId, setPeerId] = useState("");
  const [state, setState] = useState<
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ok"; data: PeerCredits | null; storeReady: boolean }
    | { phase: "error" }
  >({ phase: "idle" });

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const id = peerId.trim();
    if (!id) return;
    setState({ phase: "loading" });
    try {
      const res = await fetch(`/api/credits?peer=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as {
        storeReady: boolean;
        peer: PeerCredits | null;
      };
      setState({ phase: "ok", data: json.peer, storeReady: json.storeReady });
    } catch {
      setState({ phase: "error" });
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
        Check your credits
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-muted)]">
        Find your node id on{" "}
        <a href="/status" className="text-[var(--accent)] hover:underline">
          /status
        </a>{" "}
        and paste it to see your accrued early-access credits.
      </p>
      <form onSubmit={check} className="mt-3 flex gap-2">
        <input
          value={peerId}
          onChange={(e) => setPeerId(e.target.value)}
          placeholder="e.g. 462c322593"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-[13px] text-[var(--fg)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)]/60 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-[13px] font-semibold text-black transition hover:brightness-110"
        >
          Check
        </button>
      </form>

      {state.phase === "loading" && (
        <div className="mt-3 text-[12px] text-[var(--fg-muted)]">Checking…</div>
      )}
      {state.phase === "error" && (
        <div className="mt-3 text-[12px] text-[var(--fg-muted)]">
          Couldn&apos;t reach the ledger. Try again in a moment.
        </div>
      )}
      {state.phase === "ok" && !state.storeReady && (
        <div className="mt-3 text-[12px] text-[var(--fg-muted)]">
          The credits ledger isn&apos;t active on this deployment yet.
        </div>
      )}
      {state.phase === "ok" && state.storeReady && (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-4 py-3">
          {state.data && state.data.credits > 0 ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[12px] text-[var(--fg-muted)]">
                  {state.data.peerId}
                </span>
                <span className="font-mono text-lg font-semibold text-[var(--accent)]">
                  ~$
                  {state.data.usd < 0.01
                    ? state.data.usd.toFixed(4)
                    : state.data.usd.toFixed(2)}
                </span>
              </div>
              {Object.keys(state.data.tokensByModel).length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-[var(--border)] pt-2 text-[12px] text-[var(--fg-muted)]">
                  {Object.entries(state.data.tokensByModel).map(
                    ([model, tokens]) => (
                      <li key={model} className="flex justify-between gap-3">
                        <span className="truncate font-mono">{model}</span>
                        <span className="shrink-0">
                          {tokens.toLocaleString()} tok
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-[var(--fg-muted)]">
                Illustrative — not a payout.
              </p>
            </>
          ) : (
            <div className="text-[12px] text-[var(--fg-muted)]">
              No credits recorded for that node id yet. Serve a mesh request and
              check back.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
