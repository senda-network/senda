"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChatExperience } from "../components/ChatExperience";
import { EarlyAccessBanner } from "../components/EarlyAccessBanner";
import { Logo } from "../components/Logo";

// Three suggestions chosen to be:
// - immediately relatable (no jargon, no insider product talk)
// - structurally different from each other (write / explain / plan)
// - genuinely useful, so a visitor sees real value on first try
const SUGGESTIONS = [
  "Write a polite email canceling tomorrow's meeting.",
  "Explain compound interest to a curious 12-year-old.",
  "Plan a 3-day weekend in Lisbon with one rainy day.",
];

/**
 * The homepage chat entry.
 *
 * The redesigned homepage is a scrollable marketing page, so the chat no
 * longer owns the viewport. Instead this renders a *collapsed* composer in
 * the hero. The moment a visitor interacts with it — focusing the input,
 * submitting, or clicking a suggestion — it expands into the full
 * `ChatExperience` as a fixed overlay, seeded with whatever they typed or
 * picked. Collapsing returns them to the marketing page; the thread is
 * preserved by ChatExperience's own session/local-storage persistence.
 */
export function HeroChat() {
  const [expanded, setExpanded] = useState(false);
  const [seed, setSeed] = useState("");

  const open = (text: string) => {
    setSeed(text);
    setExpanded(true);
  };

  // Let Escape return to the marketing page while expanded. Also lock body
  // scroll so the page behind the overlay doesn't scroll under it.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  if (expanded) {
    // Portal to <body> so the fixed overlay escapes the hero's `z-10`
    // stacking context. Rendered in place, a later `z-10` sibling spacer in
    // the hero paints over the overlay's bottom region and silently
    // intercepts clicks on the composer — the chat looked "frozen" once the
    // input lost focus and couldn't be clicked back into.
    const overlay = (
      <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-[var(--bg)] text-[var(--fg)]">
        <EarlyAccessBanner />
        <header className="border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex items-center gap-2.5"
              aria-label="Back to site"
            >
              <Logo />
              <span className="text-sm font-semibold tracking-tight">
                Senda
              </span>
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1.5 text-[12px] text-[var(--fg-muted)] transition hover:text-[var(--fg)]"
            >
              ← Back to site
            </button>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col">
          <ChatExperience initialInput={seed} />
        </main>
      </div>
    );
    return typeof document !== "undefined"
      ? createPortal(overlay, document.body)
      : overlay;
  }

  return (
    <div className="w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          open(seed);
        }}
        className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2 transition focus-within:border-[var(--accent)]/60"
      >
        <textarea
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          onFocus={() => open(seed)}
          placeholder="Ask anything…"
          rows={1}
          className="max-h-[120px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-relaxed text-[var(--fg)] placeholder:text-[var(--fg-muted)] focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-black shadow-[0_6px_18px_-10px_rgba(26,157,95,0.7)] transition hover:brightness-110"
        >
          Send
        </button>
      </form>

      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => open(s)}
              className="block h-full w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 text-left text-sm text-[var(--fg-muted)] transition hover:border-[var(--accent)]/30 hover:bg-[var(--bg-elev-2)] hover:text-[var(--fg)] focus:outline-none focus-visible:border-[var(--accent)]/60"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 text-[12px] text-[var(--fg-muted)]">
        Have a machine to spare?{" "}
        <Link href="/contribute" className="text-[var(--accent)] hover:underline">
          Run a node
        </Link>{" "}
        and earn credits for tokens you serve.
      </div>
    </div>
  );
}
