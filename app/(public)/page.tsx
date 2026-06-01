import type { Metadata } from "next";
import Link from "next/link";
import { HeroChat } from "./HomepageChat";
import { MeshLiveStats } from "../components/MeshLiveStats";
import { MeshLiveStatus } from "../components/MeshLiveStatus";
import { PublicHeader } from "../components/PublicHeader";
import { PublicFooter } from "../components/PublicFooter";
import {
  ArchitectureDiagram,
  Feature,
  FitCard,
  NumberedStep,
} from "../components/marketing";

export const metadata: Metadata = {
  title: "ClosedMesh — your private LLM, on hardware people own",
  description:
    "A peer-to-peer mesh that runs open-weight models end-to-end on the hardware contributors already own — Apple Silicon Macs and GPU boxes — with no third-party AI provider in the middle. Chat in your browser or run a node.",
};

/**
 * Public homepage at https://closedmesh.com/.
 *
 * Redesigned from a full-viewport chat into a scrollable marketing page
 * that explains the product up front, while keeping the instant-try hook:
 * the hero carries a collapsed composer (HeroChat) that expands into the
 * full chat surface the moment a visitor interacts with it. No "open chat"
 * detour, no signup.
 *
 * Two audiences land here and the page serves both: someone who wants a
 * private LLM (hero + chat + "what it's for" + FAQ), and someone with
 * spare hardware who might contribute (the two-sided section + "run a
 * node" CTAs). We deliberately don't lead with anything price-related —
 * the economics may change; the architecture won't.
 *
 * Long-form technical depth (full hardware matrix, the two-layer
 * architecture writeup, every why-a-mesh property) still lives on /about;
 * this page carries condensed versions and links there.
 */
export default function PublicHomePage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <PublicHeader status={<MeshLiveStatus variant="header" />} />

      <main>
        {/* Hero — marketing first, chat embedded as a collapsed composer */}
        <section id="top" className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-3xl px-6 py-16 text-center sm:py-24">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
              Open peer-to-peer LLM mesh
            </div>
            <h1 className="mt-3 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
              Your private LLM.
              <span className="block text-[var(--fg-muted)]">
                On hardware people own.
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-[var(--fg-muted)] sm:text-base">
              A peer-to-peer mesh of contributed machines running open-weight
              models end-to-end — private, low-cost inference for summarizing,
              classifying, and background agent work. No third-party AI
              provider in the middle.
            </p>
            <div className="mt-6 flex justify-center">
              <MeshLiveStatus />
            </div>
            <div className="mx-auto mt-8 max-w-2xl">
              <HeroChat />
            </div>
          </div>
        </section>

        {/* Live proof — the swarm, right now. Honest, running numbers in
            place of a logo wall. */}
        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <div className="mb-6 text-center">
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                This isn&apos;t a render. It&apos;s the live mesh.
              </h2>
              <p className="mt-2 text-[14px] text-[var(--fg-muted)]">
                Every number below is read from the public mesh entry node,
                refreshed every 30 seconds.
              </p>
            </div>
            <div className="mx-auto max-w-3xl">
              <MeshLiveStats />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <div className="mb-10 max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                How it works
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Two roles. One mesh.
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
                Anyone can chat — at closedmesh.com or in the desktop app —
                without running anything themselves. Inference is served by
                peers who&apos;ve chosen to contribute compute by running the
                ClosedMesh LLM runtime on their own hardware. Anybody can be
                one, both, or neither.
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
                title="Mesh entry"
                body="Requests land at the public mesh entry point and are routed to a peer that can serve the requested model — by capability, by load, by latency."
              />
              <NumberedStep
                n={3}
                title="Compute peers"
                body="Volunteered nodes running ClosedMesh LLM serve each session end-to-end on whichever peer fits the model. Auto-routes around offline ones; can pair two peers via speculative decoding for the mid-tier."
              />
            </div>
          </div>
        </section>

        {/* Why a mesh — condensed from /about's full property grid */}
        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <div className="mb-10 max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                Why a mesh
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Capacity is everywhere. ClosedMesh just uses it.
              </h2>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Feature
                title="No third-party AI provider"
                body="Prompts go to a peer running an open-weight model on hardware someone in the mesh owns. No OpenAI, Anthropic or Google in the loop — nothing to revoke, no provider terms to read."
              />
              <Feature
                title="Apple Silicon is the hero"
                body="On an M3 Max or M4 Max with 64–128 GB of unified memory, a $2.5–4.5k laptop becomes a 30B–70B-capable inference box at speeds same-price Windows GPU setups can't match. CUDA / ROCm / Vulkan boxes join too — each shines at different model sizes."
              />
              <Feature
                title="Full-quality replication"
                body="A model that fits on one peer runs there end-to-end, full quality, zero per-token network overhead. For the mid-tier, two peers pair via speculative decoding — a fast draft proposes, a larger verifier accepts in one batched pass."
              />
              <Feature
                title="Peers are verified"
                body="The mesh checks that a peer actually runs the model it advertises: each publishes a deterministic fingerprint and the network re-runs an unpredictable synthetic probe to compare. A peer can't claim a big model while quietly serving a smaller one. Real prompts are never replayed."
              />
              <Feature
                title="OpenAI-compatible"
                body="Every peer exposes a standard /v1/chat/completions endpoint. Drop-in for any tool that speaks OpenAI — agents, IDE plugins, internal scripts."
              />
              <Feature
                title="Run your own peer"
                body="Don't want to trust anyone else? The runtime other peers run is the runtime you can run yourself. It's fully open source — share compute, rent it, or keep it entirely in-house."
              />
            </div>
          </div>
        </section>

        {/* Two-sided progression — chat / contribute / earn */}
        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <div className="mb-10 max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                Two sides
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Use the mesh. Or become part of it.
              </h2>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <LaneCard
                step="Chat"
                title="Open it and start typing"
                body="A private LLM in your browser — no signup, nothing to install. Your prompts go to a peer, never a third-party AI provider."
                cta={{ label: "Try the mesh →", href: "#top" }}
              />
              <LaneCard
                step="Contribute"
                title="Run a node"
                body="Have a capable Mac or GPU box? Download the desktop app or curl the runtime. It autostarts and joins the mesh, adding capacity for everyone."
                cta={{ label: "Download →", href: "/download" }}
              />
              <LaneCard
                step="Earn"
                title="Get paid per session"
                body="An emerging marketplace pays peers for the sessions they serve, with reputation and sample-and-verify keeping it honest. Rolling out as the network grows."
                muted
                cta={{ label: "How it works →", href: "/about" }}
              />
            </div>
          </div>
        </section>

        {/* What it's for */}
        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <div className="mb-10 max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                What it&apos;s for
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Built for the work you keep in-house.
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
                ClosedMesh is private, low-cost inference for the work
                open-weight models do well. It&apos;s for teams where keeping
                data in-house and keeping per-token costs flat matter more than
                shaving a second off every reply.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <FitCard
                title="Great fit"
                items={[
                  "Summarizing documents and codebases",
                  "Classifying or labeling data at scale",
                  "Long-running background agents and pipelines",
                  "Synthetic-data generation",
                  "Anything private or high-volume where an instant answer isn't the point",
                ]}
              />
              <FitCard
                title="Why it holds up"
                items={[
                  "Private by default — prompts go to a peer, never a third-party AI provider",
                  "Yours to control — runs on your own hardware and the mesh, not a rented black-box endpoint",
                  "No lock-in — OpenAI-compatible API, fully open-source runtime",
                  "Verified peers — each one proves it runs the model it advertises",
                ]}
              />
            </div>
          </div>
        </section>

        {/* FAQ — native <details>, no client JS needed */}
        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-3xl px-6 py-20">
            <div className="mb-10">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                FAQ
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                The questions people ask first
              </h2>
            </div>

            <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              <FaqItem
                q="What is ClosedMesh?"
                a="A peer-to-peer mesh that runs open-weight models end-to-end on hardware contributors already own. Chat with it in your browser; behind the scenes a capability-aware router sends each session to a peer that can serve it. No third-party AI provider sits in the middle."
              />
              <FaqItem
                q="Do I need to sign up or install anything to chat?"
                a="No. Open closedmesh.com and start typing — no account, no install. The desktop app is only needed if you want to run a node and contribute compute."
              />
              <FaqItem
                q="Can a peer read my prompts?"
                a="The peer serving your session has to read the prompt to run inference — that's the honest trade versus a hosted API. The runtime is open source so peers can be audited, sessions aren't tied to an identity, and for anything you don't want to trust to others, you can run your own peer with the same runtime."
              />
              <FaqItem
                q="Which models can I use?"
                a="Open-weight models served by live peers — the set changes as peers come and go, which is why the live status above lists what's serving right now. Apple Silicon Macs with enough memory can serve 30B–70B-class models at full quality; smaller machines serve smaller models well."
              />
              <FaqItem
                q="What hardware can contribute?"
                a="Apple Silicon Macs (Metal), and NVIDIA (CUDA), AMD (ROCm) or Intel/other (Vulkan) GPU boxes on macOS, Linux, or Windows. The installer detects your OS, CPU architecture and GPU vendor and pulls the matching build."
              />
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section>
          <div className="mx-auto max-w-5xl px-6 py-20 text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Bring a real, private LLM into your work.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--fg-muted)]">
              Chat with the mesh in your browser, or lend your hardware and grow
              it for everyone.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="#top"
                className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-black shadow-[0_6px_18px_-10px_rgba(255,122,69,0.7)] transition hover:brightness-110"
              >
                Try the mesh
              </Link>
              <Link
                href="/download"
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-5 py-2.5 text-sm font-medium text-[var(--fg)] transition hover:bg-[var(--bg-elev-2)]"
              >
                Run a node
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}

function LaneCard({
  step,
  title,
  body,
  cta,
  muted,
}: {
  step: string;
  title: string;
  body: string;
  cta: { label: string; href: string };
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-7">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
        {step}
        {muted && (
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[9px] tracking-normal text-[var(--fg-muted)]">
            coming
          </span>
        )}
      </div>
      <div className="mt-2 text-lg font-semibold tracking-tight">{title}</div>
      <p className="mt-2 flex-1 text-[14px] leading-relaxed text-[var(--fg-muted)]">
        {body}
      </p>
      <Link
        href={cta.href}
        className="mt-5 text-[13px] text-[var(--accent)] hover:underline"
      >
        {cta.label}
      </Link>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-[15px] font-medium text-[var(--fg)] [&::-webkit-details-marker]:hidden">
        {q}
        <span
          aria-hidden
          className="shrink-0 text-[var(--fg-muted)] transition group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <p className="pb-5 text-[14px] leading-relaxed text-[var(--fg-muted)]">
        {a}
      </p>
    </details>
  );
}
