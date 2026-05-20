import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../../components/Logo";
import { PublicHeader } from "../../components/PublicHeader";

export const metadata: Metadata = {
  title: "ClosedMesh updates",
  description:
    "What we shipped, when, and what the live mesh measured after. A development log for ClosedMesh — phases only, past tense only, real numbers from real peers.",
};

/**
 * Public development log at /updates.
 *
 * Hand-written, append-only. Phase-level entries only — never a per-release
 * changelog, never a roadmap. Anything not shipped doesn't appear here. The
 * private `internal/STRATEGY.md` and `internal/RESILIENCE.md` carry the
 * roadmap and the candid post-mortems; this page is the public re-narration
 * of the same material.
 *
 * Intentionally unlinked from `PublicHeader`. Shareable URL only — promote
 * to nav/footer once the entry count and refresh cadence justify it.
 *
 * Editing rules live in `.cursor/skills/dev-log/SKILL.md`. Read that before
 * adding, removing, or editing entries.
 */

type LogEntry = {
  /** URL-safe id; stable for anchor links once we link to specific entries. */
  id: string;
  /** ISO date the entry covers (ship date, not author date). */
  date: string;
  /** "Phase N" label used as the eyebrow above the title. */
  phase: string;
  /** Optional version arc this entry corresponds to ("v0.66.48", "v0.66.41 → v0.66.47"). */
  version?: string;
  /** Headline. Past-tense, factual. No "we're delighted to announce". */
  title: string;
  /** Single-paragraph summary lead, ≤2 sentences. */
  lede: string;
  /** Body paragraphs, in order. Plain prose; no marketing softening. */
  body: string[];
  /** Optional measurements rendered as a stat strip. Real numbers only. */
  metrics?: Array<{ label: string; value: string }>;
};

const ENTRIES: LogEntry[] = [
  {
    id: "phase-3-0-benchmark-honesty",
    date: "2026-05-20",
    phase: "Phase 3.0",
    version: "v0.66.49",
    title: "Native baseline alongside through-mesh, on every peer.",
    lede:
      "Every solo-serving peer now runs a synthetic chat against its own llama-server with no mesh in the path, and gossips the result. The catalog shows the through-mesh number, the native number, and the ratio between them as a coloured \"mesh efficiency\" percentage — making the entry-tunnel + auth + routing tax loud and visible.",
    body: [
      "The Phase 1 numbers we shipped on this page (0.482, 0.693 tok/s) read as performance claims to anyone who didn't read the surrounding paragraph. They were intended as proof the metric pipeline works end-to-end. The fix is not better wording — it's a second number, on the same page, measured by the same code path, that the first one can be referenced against.",
      "When a peer's llama-server reports Ready on the solo path, the runtime now spawns a background collector. After a 30-second settle delay it issues a single deterministic streaming completion (temperature=0, seed=42, max_tokens=128) directly to 127.0.0.1:llama_port — no entry tunnel, no auth gateway, no routing layer. The result is timed using the same TTFT and decode-rate logic that records through-mesh samples (including the same wall-clock fallback Phase 1 installed when decode windows collapse near zero), persisted at ~/.closedmesh/native-baselines.json keyed by model file mtime, and gossiped via a new repeated field on the peer announcement. It refreshes every 12 hours or when the model file changes.",
      "On the catalog at closedmesh.com/status, every model row now carries up to three throughput stats: the median through-mesh tok/s (already there from Phase 1), the median native tok/s (new), and a coloured \"mesh efficiency\" percentage — green at 80%+, amber 50–80%, red below 50%. The math is through ÷ native: 1.00 means the mesh path is as fast as the peer's local stack, and the gap to 1.00 is the overhead from everything we add. We don't pretty up that number; we publish it. If the ratio is high we have a story to tell; if it's low we have an attribution problem we now know about and can fix.",
      "Scope: the collector only runs on the solo-launch path. Pipeline-host and MoE-shard peers don't get a baseline yet, because their local llama-server already talks to remote rpc-servers via iroh tunnels — the \"native\" measurement would include rpc-server overhead and stop being native. Whether to measure that anyway, and how to label it, is a Phase 3.0.1 follow-up if the catalog ratio surfaces a gap there worth investigating. Pre-v0.66.49 peers gossip an empty baselines vec; the catalog renders \"no measurement yet\" rather than fabricating a zero.",
    ],
    metrics: [
      { label: "Runtime release", value: "v0.66.49 (single ship)" },
      { label: "Refresh cadence", value: "30s settle, then every 12 h or on model-file change" },
      { label: "Catalog columns added", value: "native t/s + mesh efficiency %" },
    ],
  },
  {
    id: "phase-2-routing-defaults",
    date: "2026-05-20",
    phase: "Phase 2",
    version: "v0.66.48",
    title: "Solo replication wins by default.",
    lede:
      "When any peer can serve a model end-to-end, requests land there instead of a pipeline split. Pooled splits stay in the codebase as a power-user fallback, demoted from the headline.",
    body: [
      "Until v0.66.48, asking the mesh to host Qwen3-8B and Qwen3-32B from the same configured peer set produced a pipeline-split for both models — even on machines with enough memory to run the smaller model end-to-end. Splits add a per-token network hop on every decode step, so a model that fit on one peer was being served slower than necessary, simply because the runtime wasn't choosing.",
      "The runtime now picks per-peer. A 14.5 GB Mac requested for both models drops the 32B and serves only the 8B solo. The router prefers solo hosts over split hosts at the same priority class, and only falls through to the split path when no peer can hold the model end-to-end. An admin flag (CLOSEDMESH_FORCE_SPLIT_ROUTING=1) preserves the split path for demos.",
      "On the live 4-peer cohort this means both modes run side-by-side for the first time: a single Apple Silicon laptop serves Qwen3-8B-Q4_K_M solo, while three other peers pool memory for Qwen3-32B-Q4_K_M. The catalog on closedmesh.com/status renders the two as separate rows with a visible divider, with measured throughput on each.",
    ],
    metrics: [
      { label: "Qwen3-8B-Q4_K_M (solo)", value: "0.693 tok/s · 20.66 s TTFT" },
      { label: "Qwen3-32B-Q4_K_M (pooled split)", value: "0.131 tok/s · 91.15 s TTFT" },
      { label: "Peers measured", value: "4 (1 solo · 1 host · 2 workers)" },
    ],
  },
  {
    id: "phase-1-marketplace-metrics",
    date: "2026-05-19",
    phase: "Phase 1",
    version: "v0.66.41 → v0.66.47",
    title: "Real per-model throughput, surfaced on the catalog.",
    lede:
      "Every peer now records p50 tok/s and p50 time-to-first-token per model from real inference traffic, gossips them to the entry, and the catalog renders them next to each contributor.",
    body: [
      "ClosedMesh now answers the question \"how fast does this peer actually serve this model?\" with a number that came from real chat traffic, not a synthetic benchmark. The runtime instruments its own backend proxy on the way out, so any chat — through the website, the desktop app, or the OpenAI-compatible API — produces a sample. Samples roll up into a 1-hour p50 and gossip to the entry node within ~75 seconds.",
      "The honest part of this entry: the metric path took seven runtime releases to land. Four were follow-ups for defects only the live mesh could surface — a tunnel that bypassed the chokepoint where the metric was being collected, a log filter that swallowed the diagnostic events that would have caught it, a gossip-refresh path that didn't fire when the entry had already seen the peer, and a streaming-response code path that read tok/s from the wrong field and produced 953,000 tok/s readings until we noticed. Each of those is now a regression test.",
      "The validation that closed Phase 1 was a streaming chat through closedmesh.com against a Qwen3-8B-Q4_K_M peer, producing a 0.482 tok/s sample that landed on the public dashboard via host → gossip → entry → frontend. The number proves the metric pipeline works end-to-end — it is not a performance claim. The same MBA running native llama-server on the same model goes substantially faster than that; the gap is mesh-overhead we haven't yet measured or attributed (entry tunnel? auth gateway? routing? metric-window edge cases?). Closing that gap is queued as the first deliverable of Phase 3 (\"benchmark honesty\"): every peer publishes its native baseline alongside its through-mesh measurement, the catalog shows the ratio, and we either tell a great story or we have a fixable problem we now know about.",
    ],
    metrics: [
      { label: "Runtime releases", value: "v0.66.41 → v0.66.47 (7 ships)" },
      { label: "Mid-flight defect classes fixed", value: "4 (all now regression-tested)" },
      { label: "First end-to-end sample", value: "Qwen3-8B-Q4_K_M @ 0.482 tok/s" },
    ],
  },
  {
    id: "phase-0-narrative",
    date: "2026-05-18",
    phase: "Phase 0",
    title: "Stopped describing ClosedMesh as VRAM pooling.",
    lede:
      "The public surface used to lead with \"pool VRAM into one virtual GPU.\" That framing is wrong on the architecture and wrong on the value — replaced this week with \"a swarm of peers, each running open-weight models on hardware they already own.\"",
    body: [
      "Pipeline-splitting two laptops to run a 70B model is something ClosedMesh can do, and for some demos still should do. But it isn't what the network is for. The network is for routing each session to whichever peer can serve the requested model end-to-end at full quality, paying a one-time cost to pick the right peer instead of a per-token network cost on every decode step. Apple Silicon's unified memory makes that achievable on hardware contributors already own — a $2.5–4.5k laptop is genuinely capable of serving 30B–70B parameter models at full quality.",
      "Phase 0 was the website, the about page, the homepage chat empty state, the README, and the architecture diagram, rewritten around that thesis. No engineering work — but the narrative had to ship before the engineering work that follows it (capability-aware routing in Phase 2, reputation in Phase 3) had a coherent story to slot into.",
      "The pipeline-split path stayed in the codebase. It now appears as a power-user fallback for models that don't fit any single peer, mentioned explicitly so existing contributors who installed for that feature don't feel rug-pulled. Same code, different hierarchy.",
    ],
  },
];

export default function LogPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <PublicHeader variant="default" />

      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <header className="mb-14 max-w-2xl">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
            Updates
          </div>
          <h1 className="mt-2 text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl">
            What ClosedMesh shipped, and what the mesh measured after.
          </h1>
          <p className="mt-4 text-pretty text-[15px] leading-relaxed text-[var(--fg-muted)]">
            One entry per shipped phase, in reverse chronological order. No
            roadmap, no per-release changelog. Live measurements live on{" "}
            <Link
              href="/status"
              className="text-[var(--accent)] hover:underline"
            >
              /status
            </Link>
            ; this page is the temporal complement — what the team built each
            week, with the numbers that came out the other side.
          </p>
          <p className="mt-4 text-pretty text-[14px] leading-relaxed text-[var(--fg-muted)]">
            <span className="font-medium text-[var(--fg)]">
              On the numbers below:
            </span>{" "}
            they are honest measurements from the same data path users hit,
            not ceiling claims. Through-mesh throughput today sits well below
            what each peer can do natively in raw <code>llama-server</code>;
            quantifying that gap and closing it is queued as the first
            deliverable of Phase 3.
          </p>
        </header>

        <ol className="flex flex-col gap-14">
          {ENTRIES.map((entry) => (
            <li
              key={entry.id}
              id={entry.id}
              className="scroll-mt-24 border-t border-[var(--border)] pt-10 first:border-t-0 first:pt-0"
            >
              <Entry entry={entry} />
            </li>
          ))}
        </ol>
      </main>

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-3xl flex-col items-start justify-between gap-6 px-6 py-12 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div className="text-[12px] text-[var(--fg-muted)]">
              ClosedMesh — open peer-to-peer LLM mesh.
            </div>
          </div>
          <div className="flex items-center gap-5 text-[12px]">
            <Link
              href="/"
              className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              Open chat
            </Link>
            <Link
              href="/status"
              className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              Live status
            </Link>
            <Link
              href="/about"
              className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              How it works
            </Link>
            <a
              href="https://github.com/closedmesh/closedmesh-llm"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              Runtime on GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Entry({ entry }: { entry: LogEntry }) {
  const dateLabel = new Date(entry.date + "T00:00:00Z").toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
  );
  return (
    <article>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">
        <span className="text-[var(--accent)]">{entry.phase}</span>
        <span aria-hidden>·</span>
        <time dateTime={entry.date}>{dateLabel}</time>
        {entry.version && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono normal-case tracking-normal">
              {entry.version}
            </span>
          </>
        )}
      </div>

      <h2 className="mt-3 text-balance text-2xl font-semibold leading-snug tracking-tight sm:text-[1.7rem]">
        {entry.title}
      </h2>

      <p className="mt-4 text-pretty text-[15px] leading-relaxed text-[var(--fg)]/90">
        {entry.lede}
      </p>

      <div className="mt-5 flex flex-col gap-4 text-[14.5px] leading-relaxed text-[var(--fg-muted)]">
        {entry.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {entry.metrics && entry.metrics.length > 0 && (
        <dl className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
          {entry.metrics.map((m) => (
            <div
              key={m.label}
              className="flex flex-col gap-1 bg-[var(--bg-elev)] px-4 py-3"
            >
              <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                {m.label}
              </dt>
              <dd className="font-mono text-[12.5px] text-[var(--fg)]">
                {m.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
