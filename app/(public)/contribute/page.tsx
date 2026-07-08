import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "../../components/PublicHeader";
import { PublicFooter } from "../../components/PublicFooter";
import { MeshLiveStats } from "../../components/MeshLiveStats";
import { CreditsLeaderboard } from "../../components/CreditsLeaderboard";
import { CreditsChecker } from "../../components/CreditsChecker";
import {
  PEER_PAYOUT_USD_PER_MTOKEN_BY_TIER,
  TIER_LABELS,
} from "../../lib/model-tiers";

export const metadata: Metadata = {
  title: "Run a node — Senda",
  description:
    "Contribute compute to the Senda peer-to-peer LLM mesh. Earn credits for tokens served, see live network stats, and install the desktop app or CLI runtime.",
};

/**
 * /contribute — supply-side onboarding for the early-access launch.
 *
 * Explains why run a node, conservative earnings math (illustrative rates
 * from model-tiers), hardware requirements, and install paths. Credits are
 * honest about not being cash yet.
 */
export default function ContributePage() {
  const dailyRate = PEER_PAYOUT_USD_PER_MTOKEN_BY_TIER.daily_driver;
  const capacityRate = PEER_PAYOUT_USD_PER_MTOKEN_BY_TIER.capacity;
  const exampleDailyTokens = 5_000_000;
  const exampleCapacityTokens = 500_000;
  const exampleDailyUsd =
    (exampleDailyTokens / 1_000_000) * dailyRate;
  const exampleCapacityUsd =
    (exampleCapacityTokens / 1_000_000) * capacityRate;

  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <PublicHeader variant="default" />

      <main>
        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
              Contribute compute
            </div>
            <h1 className="mt-3 text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl">
              Run a node. Serve the mesh. Earn credits.
            </h1>
            <p className="mt-4 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--fg-muted)]">
              Senda routes chat and API traffic to peers whose hardware
              fits each model. Contributors who serve real sessions accumulate{" "}
              <strong className="font-medium text-[var(--fg)]">credits</strong>{" "}
              — tracked now, redeemable when the payout rail ships. No crypto
              token, no signup wall, no promise of instant cash.
            </p>
            <div className="mt-8">
              <MeshLiveStats />
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/download"
                className="rounded-md bg-[var(--accent)] px-5 py-2.5 text-[13px] font-semibold text-black shadow-[0_6px_18px_-10px_rgba(26,157,95,0.7)] transition hover:brightness-110"
              >
                Download desktop app
              </Link>
              <a
                href="https://senda.network/install"
                className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] px-5 py-2.5 text-[13px] font-medium text-[var(--fg)] transition hover:bg-[var(--bg-elev-2)]"
              >
                Install CLI runtime
              </a>
              <Link
                href="/status"
                className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] px-5 py-2.5 text-[13px] font-medium text-[var(--fg-muted)] transition hover:text-[var(--fg)]"
              >
                Live status →
              </Link>
            </div>
          </div>
        </section>

        <section
          id="earn"
          className="border-b border-[var(--border)] bg-[var(--bg-elev)]/40"
        >
          <div className="mx-auto max-w-3xl px-6 py-16">
            <h2 className="text-xl font-semibold tracking-tight">
              How credits work (early access)
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
              The runtime counts completion tokens your machine serves to mesh
              requests over a rolling 7-day window. The desktop dashboard
              multiplies that tally by illustrative per-tier rates to show what
              your contribution <em>will</em> be worth — not money owed today.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <RateCard
                tier={TIER_LABELS.daily_driver}
                rate={dailyRate}
                exampleTokens={exampleDailyTokens}
                exampleUsd={exampleDailyUsd}
                blurb="8B–14B class models at chat-viable latency. Highest volume, most contributors."
              />
              <RateCard
                tier={TIER_LABELS.capacity}
                rate={capacityRate}
                exampleTokens={exampleCapacityTokens}
                exampleUsd={exampleCapacityUsd}
                blurb="32B–70B models that fit on beefy solo peers or pooled splits. Scarcer capacity, higher illustrative rate."
              />
            </div>

            <div className="mt-6 rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-[13px] leading-relaxed text-[var(--fg-muted)]">
              <span className="font-semibold text-amber-200">
                Illustrative only — not a payout.
              </span>{" "}
              Credits accrue on the public ledger when your peer serves mesh
              chat traffic. Redemption is manual for the first cohort until
              automated payouts ship. Early-node multipliers for the first ~100
              peers are planned.
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-2">
              <CreditsLeaderboard />
              <CreditsChecker />
            </div>
          </div>
        </section>

        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-3xl px-6 py-16">
            <h2 className="text-xl font-semibold tracking-tight">
              Why run a node?
            </h2>
            <ul className="mt-6 space-y-4 text-[15px] leading-relaxed text-[var(--fg-muted)]">
              <li className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>
                  <strong className="font-medium text-[var(--fg)]">
                    Turn idle hardware into mesh capacity.
                  </strong>{" "}
                  An M-series Mac with 16GB+ unified memory or a CUDA box with
                  12GB+ VRAM can serve daily-driver models while you sleep.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>
                  <strong className="font-medium text-[var(--fg)]">
                    See contribution in the dashboard.
                  </strong>{" "}
                  Tokens served, models loaded, uptime, and estimated credits
                  appear in the desktop app&apos;s local controller.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>
                  <strong className="font-medium text-[var(--fg)]">
                    Open runtime you can audit.
                  </strong>{" "}
                  Same stack whether you contribute or run entirely for
                  yourself. Read the{" "}
                  <Link href="/security" className="text-[var(--accent)] hover:underline">
                    threat model
                  </Link>{" "}
                  before sharing a machine you care about.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-3xl px-6 py-16">
            <h2 className="text-xl font-semibold tracking-tight">
              Hardware that works well
            </h2>
            <div className="mt-6 overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full min-w-[480px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg-elev)] text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">
                    <th className="px-4 py-3 font-medium">Platform</th>
                    <th className="px-4 py-3 font-medium">Backend</th>
                    <th className="px-4 py-3 font-medium">Sweet spot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-[var(--fg-muted)]">
                  <HwRow
                    platform="Apple Silicon Mac"
                    backend="Metal"
                    sweet="Qwen3-8B solo; 30B+ with enough unified memory"
                  />
                  <HwRow
                    platform="Linux / Windows NVIDIA"
                    backend="CUDA"
                    sweet="Daily-driver + capacity models on 12GB+ VRAM"
                  />
                  <HwRow
                    platform="AMD / Intel GPU"
                    backend="Vulkan / ROCm"
                    sweet="Daily-driver tier; join the mesh, measure on /status"
                  />
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[14px] text-[var(--fg-muted)]">
              The installer at{" "}
              <a
                href="https://senda.network/install"
                className="text-[var(--accent)] hover:underline"
              >
                senda.network/install
              </a>{" "}
              detects your platform and pulls the matching runtime build.
            </p>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-3xl px-6 py-16">
            <h2 className="text-xl font-semibold tracking-tight">
              Get started in three steps
            </h2>
            <ol className="mt-6 space-y-6">
              <Step
                n={1}
                title="Install"
                body="Download the desktop app or run the install script. The runtime autostarts and joins the public mesh via an embedded invite token."
              />
              <Step
                n={2}
                title="Share a model"
                body="Pick a model your hardware fits — start with Qwen3-8B-Q4_K_M if unsure. The dashboard shows load progress and when you're serving."
              />
              <Step
                n={3}
                title="Watch credits accrue"
                body="Serve mesh chat or API traffic. The dashboard's earnings preview updates from real completion-token counts. Check /status to see yourself on the public catalog."
              />
            </ol>
            <p className="mt-8 text-[14px] text-[var(--fg-muted)]">
              Questions or want to join the first operator cohort? Open a
              discussion on{" "}
              <a
                href="https://github.com/senda-network/senda-llm/discussions"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                GitHub Discussions
              </a>
              . Ship log:{" "}
              <Link href="/updates" className="text-[var(--accent)] hover:underline">
                /updates
              </Link>
              .
            </p>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}

function RateCard({
  tier,
  rate,
  exampleTokens,
  exampleUsd,
  blurb,
}: {
  tier: string;
  rate: number;
  exampleTokens: number;
  exampleUsd: number;
  blurb: string;
}) {
  const tokensM = (exampleTokens / 1_000_000).toFixed(1);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
        {tier}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold text-[var(--fg)]">
        ${rate.toFixed(2)}
        <span className="text-[14px] font-normal text-[var(--fg-muted)]">
          {" "}
          / million tokens
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-muted)]">
        {blurb}
      </p>
      <p className="mt-3 border-t border-[var(--border)] pt-3 text-[12px] text-[var(--fg-muted)]">
        Example: {tokensM}M tokens served →{" "}
        <span className="font-medium text-[var(--fg)]">
          ~${exampleUsd.toFixed(2)} illustrative
        </span>
      </p>
    </div>
  );
}

function HwRow({
  platform,
  backend,
  sweet,
}: {
  platform: string;
  backend: string;
  sweet: string;
}) {
  return (
    <tr>
      <td className="px-4 py-3 font-medium text-[var(--fg)]">{platform}</td>
      <td className="px-4 py-3 font-mono text-[12px]">{backend}</td>
      <td className="px-4 py-3">{sweet}</td>
    </tr>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elev)] text-[13px] font-semibold text-[var(--accent)]">
        {n}
      </div>
      <div>
        <div className="font-medium text-[var(--fg)]">{title}</div>
        <p className="mt-1 text-[14px] leading-relaxed text-[var(--fg-muted)]">
          {body}
        </p>
      </div>
    </li>
  );
}
