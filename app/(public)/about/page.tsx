import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../../components/Logo";
import { MeshLiveStats } from "../../components/MeshLiveStats";
import {
  ArchitectureDiagram,
  Feature,
  NumberedStep,
} from "../../components/marketing";

export const metadata: Metadata = {
  title: "How ClosedMesh works",
  description:
    "The technical deep dive: why the unit of work is a session and not a token, how peers cooperate, how requests route, what the privacy and trust model actually is, and what ClosedMesh deliberately isn't.",
};

/**
 * /about — the engineer's deep dive.
 *
 * The homepage (`/`) is the marketing read: what it is, why a mesh, what
 * it's for. This page is the other reader from the whitepaper — the senior
 * LLM-systems engineer who wants to know *why* the architecture is shaped
 * the way it is. So it leads with the physics (sessions, not tokens),
 * walks the cooperation primitives and the request path, and is honest
 * about the trust model and the limits. Content mirrors internal
 * WHITEPAPER.md §§1–3, 8, 9 (kept public-safe).
 */
export default function AboutPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg)]/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">
                ClosedMesh
              </div>
              <div className="text-[11px] text-[var(--fg-muted)]">
                Open peer-to-peer LLM mesh.
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-5 text-[12px]">
            <Link
              href="/download"
              className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              Download
            </Link>
            <Link
              href="/"
              className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              Open chat →
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
          <div className="flex flex-col items-start gap-8">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-3">
              <Logo size={42} />
            </div>
            <div className="max-w-3xl">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
                How it works · deep dive
              </div>
              <h1 className="mt-3 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
                One collective computer.
                <span className="block text-[var(--fg-muted)]">
                  Made of every machine that joins.
                </span>
              </h1>
              <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-[var(--fg-muted)] sm:text-lg">
                ClosedMesh runs open-weight models end-to-end on the hardware
                contributors already own. The interesting part isn&apos;t that
                it&apos;s peer-to-peer — plenty of those have failed — it&apos;s
                that the whole design is built around the one constraint that
                killed the others: the physics of residential internet. This
                page is the honest version of how that works.
              </p>
            </div>

            {/* Live stats island — reading the entry node every 30s. */}
            <div className="w-full max-w-3xl">
              <MeshLiveStats />
            </div>
          </div>
        </div>
      </section>

      {/* The physics — sessions, not tokens */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="mb-10 max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
              The constraint
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              The unit of work is a session, not a token.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
              Datacenter GPUs talk to each other over NVLink and InfiniBand at
              roughly 50–200 microseconds round-trip. Residential internet is
              20–200 milliseconds — three to four orders of magnitude slower,
              and two to three orders worse on bandwidth. No amount of clever
              code closes that gap. Every architectural decision below follows
              from taking it seriously instead of pretending it away.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <Feature
              title="Per-token cross-peer traffic is fatal"
              body="Put the network on the per-token critical path and a 70B model that should decode around 30 tokens/sec collapses below 1 under real-world latency. This is exactly where Petals, BitTensor inference, and the earlier Mesh-LLM forks died."
            />
            <Feature
              title="Per-session cross-peer traffic is fine"
              body="A one-second setup and a few-millisecond handoff per thousand tokens is invisible to a user. So ClosedMesh routes a whole session to one peer — it doesn't stitch fragments of a forward pass across slow links mid-decode."
            />
            <Feature
              title="Speculative decoding is the exception"
              body="It's the one multi-peer pattern where a single network hop amortises across a whole batch of tokens. That's why it's the only cross-peer cooperation ClosedMesh leans on, and why it's the path to models bigger than one peer can solo."
            />
          </div>
        </div>
      </section>

      {/* The two layers */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="mb-10 max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
              Architecture
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Two layers, one product.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
              ClosedMesh is split between a thin product surface — the chat UI
              you&apos;re using right now — and a peer-to-peer inference
              runtime that handles model loading, routing, and distribution
              across machines. They&apos;re shipped and versioned separately.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <LayerCard
              eyebrow="Chat surface"
              title="ClosedMesh"
              subtitle="Where you actually use the thing."
              points={[
                "A web chat at closedmesh.com — open it and start typing.",
                "A native desktop app that ships the same chat plus the controls for running a node yourself.",
                "Streaming responses, thread persistence, model picker, OpenAI-compatible API for tools and agents.",
              ]}
            />
            <LayerCard
              eyebrow="Inference runtime · open source"
              title="ClosedMesh LLM"
              subtitle="The peer-to-peer engine that serves the chat."
              points={[
                "Runs on machines volunteered to the mesh — Apple Silicon Macs, NVIDIA / AMD / Intel GPU boxes, on-prem workstations.",
                "Replication-first: a model that fits on one peer runs there end-to-end, full quality, zero per-token network overhead.",
                "Speculative decoding across two peers — small fast draft + larger verifier — for the mid-tier where one peer isn't enough.",
                "Capability-aware routing: requests only go to peers that can actually serve them.",
                "Built on an Iroh QUIC overlay with a gossip protocol for capability announcement.",
              ]}
              footer={
                <a
                  href="https://github.com/closedmesh/closedmesh-llm"
                  className="text-[12px] text-[var(--accent)] hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  github.com/closedmesh/closedmesh-llm →
                </a>
              }
            />
          </div>
        </div>
      </section>

      {/* Cooperation primitives */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="mb-10 max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
              Cooperation
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Four ways peers work together.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
              In order of how often they&apos;re the right answer. The first is
              the common case the whole system is tuned for; the last is a
              power-user fallback we&apos;d rather you didn&apos;t need.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Feature
              title="Replication — the default"
              body="One peer serves a whole session end-to-end at full quality. A model that fits on one machine runs there, with zero per-token network overhead. This is the common case and the one ClosedMesh optimises for."
            />
            <Feature
              title="Speculative pairs — the mid-tier"
              body="Two peers cooperate: a small fast draft proposes 4–8 tokens, a larger verifier accepts them in a single batched pass. The WAN hop amortises across the batch, so both peers earn for one session without the network choking decode."
            />
            <Feature
              title="Inter-model collaboration"
              body="Several peers can quietly contribute to one answer — a multi-modal input handled by one model, a second opinion from another. The caller still sees a single streamed response."
            />
            <Feature
              title="Pipeline / expert split — the fallback"
              body="For models too large for any single peer, weights can be split across machines. It's documented and available, but deprecated as a daily driver: it puts the network back on the critical path, which the physics above says to avoid."
            />
          </div>
        </div>
      </section>

      {/* Request flow */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="mb-10 max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
              The path of a request
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              From your keystroke to a peer and back.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
              Anyone can chat without running anything. Inference is served by
              peers who&apos;ve chosen to contribute compute by running the
              ClosedMesh LLM runtime on their own hardware. Anybody can be one,
              both, or neither.
            </p>
          </div>

          <ArchitectureDiagram />

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <NumberedStep
              n={1}
              title="Chat"
              body="Web at closedmesh.com or in the desktop app. Type a message, get a streamed response. No account, no setup, nothing to install."
            />
            <NumberedStep
              n={2}
              title="Mesh entry + routing"
              body="Requests land at the public mesh entry point. A capability-aware router picks a peer that can actually serve the requested model — by backend, memory, loaded models, load, and latency — using session-sticky hashing so follow-up turns prefer the peer that already holds the KV cache."
            />
            <NumberedStep
              n={3}
              title="Compute peers"
              body="Volunteered nodes serve each session end-to-end on whichever peer fits the model. The router auto-routes around offline ones, and can pair two peers via speculative decoding for the mid-tier."
            />
          </div>
        </div>
      </section>

      {/* Privacy & trust */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="mb-10 max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
              Privacy &amp; trust
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              What you&apos;re trusting — and what you&apos;re not.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
              The honest version: when you chat, you&apos;re trusting the peer
              your session lands on, the mesh entry node, and the chat UI. You
              are <span className="text-[var(--fg)]">not</span> trusting any
              third-party AI provider. That&apos;s the trade — here&apos;s what
              backs it.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-2">
            <Feature
              title="Open-source runtime"
              body="Every peer runs the same open-source runtime, so what a peer can and can't do is auditable. There's no closed black box deciding what happens to your prompt."
            />
            <Feature
              title="Session pseudonymity"
              body="No login. A peer doesn't know who you are unless your prompt reveals it, and sessions aren't tied to an identity. Traffic to the entry node is TLS-encrypted."
            />
            <Feature
              title="Verified peers"
              body="Each peer publishes a deterministic model-identity fingerprint, and the network re-runs an unpredictable synthetic probe to confirm it actually serves the model it advertises. A peer can't claim a big model while quietly serving a smaller one. Only synthetic probes are replayed — never your prompts."
            />
            <Feature
              title="Run your own peer"
              body="For work you don't want to trust to anyone else, the runtime other peers run is the runtime you can run yourself. Nothing about the design forces you to share compute or rent it from others."
            />
          </div>

          <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
            <div className="text-sm font-semibold tracking-tight text-amber-200">
              The honest limit
            </div>
            <p className="mt-2 text-[14px] leading-relaxed text-amber-100/80">
              The peer serving your session has to read the prompt to run
              inference — that&apos;s inherent to inference, not a ClosedMesh
              choice. End-to-end confidentiality from the serving peer (e.g.
              trusted-execution-environment hardware) is a research bet we
              haven&apos;t shipped, and we&apos;re not going to pretend
              otherwise. Until then, the mitigations are reputation, the verify
              system, and the option to run your own peer.
            </p>
          </div>
        </div>
      </section>

      {/* Hardware matrix */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="mb-10 max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
              Hardware support
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Whatever the team is already running.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
              The installer detects OS, CPU architecture and GPU vendor, then
              pulls the matching runtime build. You can also pin a backend
              explicitly for unusual setups. Apple Silicon is the hero hardware
              — M-series unified memory is what makes a consumer machine
              genuinely capable of 30B–70B models — but the mesh is
              heterogeneous on purpose.
            </p>
          </div>

          <HardwareMatrix />
        </div>
      </section>

      {/* What it isn't */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="mb-10 max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
              Limits
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              What ClosedMesh isn&apos;t.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
              Stating the obvious objections before you do. ClosedMesh is for
              latency-tolerant, private, high-volume work — not for everything.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Feature
              title="Not a frontier-model network"
              body="There are no GPT-class closed weights here. ClosedMesh serves open-weight models, which have caught up on most non-frontier work but aren't the top of the leaderboard."
            />
            <Feature
              title="Not the fastest median chat"
              body="A hosted API wins on first-token latency for a single quick reply. ClosedMesh is the wrong tool for shaving a second off every message and the right one for work where an instant answer isn't the point."
            />
            <Feature
              title="Not a training network"
              body="No gradient passes across the mesh. The residential-WAN physics that make per-token cross-peer traffic fatal make distributed training a non-starter — it's explicitly out of scope."
            />
            <Feature
              title="Not fungible compute"
              body="The unit is a session of a specific model served at measured quality — not an interchangeable GPU-second. A token from a 0.6B draft and a token from a 70B verifier are different products, and ClosedMesh prices them that way."
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 px-6 py-12 sm:flex-row sm:items-center">
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
              href="/download"
              className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              Download
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

function LayerCard({
  eyebrow,
  title,
  subtitle,
  points,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  points: string[];
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-7">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
        {eyebrow}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{title}</div>
      <div className="mt-1 text-[13px] text-[var(--fg-muted)]">{subtitle}</div>
      <ul className="mt-6 flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--fg)]/90">
        {points.map((p) => (
          <li key={p} className="flex gap-2.5">
            <span
              className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]"
              aria-hidden
            />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="mt-6">{footer}</div>}
    </div>
  );
}

function HardwareMatrix() {
  const rows: Array<{ os: string; arch: string; backend: string }> = [
    { os: "macOS", arch: "Apple Silicon", backend: "Metal" },
    { os: "Linux", arch: "x86_64 · NVIDIA", backend: "CUDA" },
    { os: "Linux", arch: "x86_64 · AMD", backend: "ROCm" },
    { os: "Linux", arch: "x86_64 · Intel / other", backend: "Vulkan" },
    { os: "Linux", arch: "x86_64 · CPU-only", backend: "CPU" },
    { os: "Linux", arch: "aarch64", backend: "Vulkan / CPU" },
    { os: "Windows 10/11", arch: "x86_64 · NVIDIA", backend: "CUDA" },
    { os: "Windows 10/11", arch: "x86_64 · AMD / Intel / other", backend: "Vulkan" },
    { os: "WSL2", arch: "x86_64 · NVIDIA passthrough", backend: "CUDA" },
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg-elev-2)] text-left text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
          <tr>
            <th className="px-5 py-3">OS</th>
            <th className="px-5 py-3">Hardware</th>
            <th className="px-5 py-3">Backend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.os}-${r.arch}`}
              className="border-t border-[var(--border)] text-[var(--fg)]"
            >
              <td className="px-5 py-3 font-medium">{r.os}</td>
              <td className="px-5 py-3 text-[var(--fg-muted)]">{r.arch}</td>
              <td className="px-5 py-3 font-mono text-[12px]">{r.backend}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
