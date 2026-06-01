import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../../components/Logo";
import { MeshLiveStats } from "../../components/MeshLiveStats";

export const metadata: Metadata = {
  title: "How ClosedMesh works",
  description:
    "One collective computer made of every machine that joins. A peer-to-peer mesh that runs open-weight models end-to-end on the hardware contributors already own — Apple Silicon Macs, NVIDIA / AMD / Intel GPU boxes — with no third-party AI provider in the middle.",
};

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
              <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
                One collective computer.
                <span className="block text-[var(--fg-muted)]">
                  Made of every machine that joins.
                </span>
              </h1>
              <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-[var(--fg-muted)] sm:text-lg">
                ClosedMesh runs open-weight models end-to-end on the
                hardware contributors already own. An M3 Max or M4 Max
                with 64–128 GB of unified memory is genuinely capable
                of serving 30B–70B parameter models at full quality;
                smaller M-series chips and dedicated GPU boxes serve
                smaller models well. The mesh&apos;s job is to find the
                best peer for each session and pair two peers via
                speculative decoding when one peer isn&apos;t enough.
                Chat from closedmesh.com or the desktop app, no install
                required. Add a node from any capable machine to grow
                capacity for the swarm. No third-party AI provider in
                the middle.
              </p>
            </div>

            {/* Live stats island — reading the entry node every 30s. The
                swarm is the product, so the marketing surface should look
                like a status page, not a brochure. */}
            <div className="w-full max-w-3xl">
              <MeshLiveStats />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <span className="rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1 text-[var(--fg-muted)]">
                Apple Silicon native
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1 text-[var(--fg-muted)]">
                Replication-first
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1 text-[var(--fg-muted)]">
                Speculative decoding across peers
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1 text-[var(--fg-muted)]">
                OpenAI-compatible runtime
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1 text-[var(--fg-muted)]">
                Mac · Linux · Windows
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* What it's for — lead with the use case, then the durable
          advantages that make those use cases hold up. The one honest
          expectation ("not for shaving a second off every reply") lives
          in the paragraph, not in a column of weaknesses. */}
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
              ClosedMesh is private, low-cost inference on hardware people
              already own — built for the work open-weight models do well:
              summarizing documents and codebases, classifying and labeling
              data at scale, long-running background agents, synthetic-data
              generation. Your prompts go to a peer in the mesh, never to a
              third-party AI provider. It&apos;s for teams where keeping data
              in-house and keeping per-token costs flat matter more than
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
                "Predictable cost — your own hardware and the mesh, not a metered per-token bill",
                "No lock-in — OpenAI-compatible API, fully open-source runtime",
                "Verified peers — each one proves it runs the model it advertises",
              ]}
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
                "Pipeline-split and MoE expert-shard available as a power-user fallback for models that don't fit any single peer.",
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

      {/* Diagram */}
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

      {/* Properties grid */}
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
              body="Prompts go to a peer running an open-weight model on hardware that someone in the mesh owns. No OpenAI, Anthropic or Google in the loop — nothing to revoke, no provider terms to read."
            />
            <Feature
              title="Apple Silicon is the hero"
              body="On the right configuration — M3 Max or M4 Max with 64–128 GB of unified memory — a $2.5–4.5k laptop becomes a 30B–70B-capable inference box at speeds same-price Windows GPU setups can't match. Smaller M-series chips serve 7B–13B-class models well. CUDA / ROCm / Vulkan boxes happily join too — each shines at different model sizes."
            />
            <Feature
              title="Speculative decoding across peers"
              body="Two peers cooperate per session — a small fast draft proposes 4–8 tokens, a larger verifier accepts them in one batched pass. The network hop amortises across many tokens, both peers earn for the same session."
            />
            <Feature
              title="Peers are verified"
              body="Anyone can join, so the mesh checks that a peer actually runs the model it advertises. Each peer publishes a deterministic model-identity fingerprint and the network re-runs an unpredictable synthetic probe to compare — a peer can't claim a big model while quietly serving a smaller one. The probes are synthetic; real prompts are never replayed."
            />
            <Feature
              title="OpenAI-compatible"
              body="Every peer exposes a standard /v1/chat/completions endpoint. Drop-in for any tool that speaks OpenAI — agents, IDE plugins, internal scripts."
            />
            <Feature
              title="Auto-route around failure"
              body="Laptops sleep. Workstations reboot. The mesh keeps serving — requests are dispatched only to live, capability-matched peers."
            />
            <Feature
              title="One-step contribute"
              body="Want to lend compute? Download the desktop app or curl the runtime. It registers a launchd / systemd / scheduled-task autostart and joins the mesh."
            />
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
              explicitly for unusual setups.
            </p>
          </div>

          <HardwareMatrix />
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

function NumberedStep({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] text-[var(--accent)]">
          0{n}
        </span>
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-muted)]">
        {body}
      </p>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-6">
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-muted)]">
        {body}
      </p>
    </div>
  );
}

function FitCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-6">
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <ul className="mt-4 flex flex-col gap-2.5 text-[14px] leading-relaxed text-[var(--fg)]/90">
        {items.map((it) => (
          <li key={it} className="flex gap-2.5">
            <span
              className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]"
              aria-hidden
            />
            <span>{it}</span>
          </li>
        ))}
      </ul>
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

function ArchitectureDiagram() {
  const accent = "var(--accent)";
  const fg = "var(--fg)";
  const fgMuted = "var(--fg-muted)";
  const elev = "var(--bg-elev)";
  const border = "var(--border)";

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-6 sm:p-10">
      <svg
        viewBox="0 0 880 320"
        className="h-auto w-full"
        role="img"
        aria-label="ClosedMesh architecture: chat clients to mesh entry point to peer compute"
      >
        <defs>
          <marker
            id="cm-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={fgMuted} />
          </marker>
        </defs>

        {/* Browser */}
        <g>
          <rect
            x="20"
            y="100"
            width="180"
            height="120"
            rx="14"
            fill={elev}
            stroke={border}
          />
          <text
            x="110"
            y="135"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="13"
            fontWeight={600}
            fill={fg}
          >
            Chat client
          </text>
          <text
            x="110"
            y="158"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="11"
            fill={fgMuted}
          >
            closedmesh.com
          </text>
          <text
            x="110"
            y="190"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="11"
            fill={fgMuted}
          >
            or desktop app
          </text>
        </g>

        {/* Arrow 1 */}
        <line
          x1="200"
          y1="160"
          x2="298"
          y2="160"
          stroke={fgMuted}
          strokeWidth="1.5"
          markerEnd="url(#cm-arrow)"
        />
        <text
          x="249"
          y="148"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="10"
          fill={fgMuted}
        >
          /api/chat
        </text>

        {/* Local controller */}
        <g>
          <rect
            x="300"
            y="100"
            width="200"
            height="120"
            rx="14"
            fill={elev}
            stroke={border}
          />
          <text
            x="400"
            y="135"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="13"
            fontWeight={600}
            fill={fg}
          >
            Mesh entry
          </text>
          <text
            x="400"
            y="158"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="11"
            fill={fgMuted}
          >
            OpenAI-compatible /v1
          </text>
          <text
            x="400"
            y="190"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="11"
            fill={fgMuted}
          >
            capability-aware router
          </text>
        </g>

        {/* Arrow 2 */}
        <line
          x1="500"
          y1="160"
          x2="598"
          y2="160"
          stroke={fgMuted}
          strokeWidth="1.5"
          markerEnd="url(#cm-arrow)"
        />
        <text
          x="549"
          y="148"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="10"
          fill={fgMuted}
        >
          /v1
        </text>

        {/* Mesh group */}
        <g>
          <rect
            x="600"
            y="40"
            width="260"
            height="240"
            rx="14"
            fill="transparent"
            stroke={border}
            strokeDasharray="4 4"
          />
          <text
            x="730"
            y="62"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="11"
            fill={fgMuted}
          >
            ClosedMesh LLM peers
          </text>

          {/* Three peer dots with center hub */}
          {/* center hub */}
          <circle cx="730" cy="170" r="6" fill={fg} opacity="0.85" />
          {/* peers */}
          <circle cx="730" cy="100" r="9" fill={accent} />
          <circle cx="660" cy="220" r="9" fill={accent} />
          <circle cx="800" cy="220" r="9" fill={accent} />
          {/* mesh edges */}
          <line
            x1="730"
            y1="109"
            x2="730"
            y2="164"
            stroke={fg}
            strokeOpacity="0.5"
            strokeWidth="1.2"
          />
          <line
            x1="668"
            y1="214"
            x2="724"
            y2="174"
            stroke={fg}
            strokeOpacity="0.5"
            strokeWidth="1.2"
          />
          <line
            x1="792"
            y1="214"
            x2="736"
            y2="174"
            stroke={fg}
            strokeOpacity="0.5"
            strokeWidth="1.2"
          />
          {/* peer labels */}
          <text
            x="730"
            y="86"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="10"
            fill={fgMuted}
          >
            M-series Mac
          </text>
          <text
            x="660"
            y="246"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="10"
            fill={fgMuted}
          >
            CUDA · 4090
          </text>
          <text
            x="800"
            y="246"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="10"
            fill={fgMuted}
          >
            Vulkan laptop
          </text>
        </g>
      </svg>
    </div>
  );
}
