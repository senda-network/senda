import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "../../components/PublicHeader";
import { PublicFooter } from "../../components/PublicFooter";

export const metadata: Metadata = {
  title: "Privacy — Senda",
  description:
    "How Senda handles your data: no accounts, session pseudonymity, prompts go to a peer running an open model, and the honest trade-offs of peer-to-peer inference.",
};

const UPDATED = "June 29, 2026";

/**
 * /privacy — an honest privacy policy that matches the product's actual
 * behaviour rather than boilerplate: no accounts, prompts are read by the
 * serving peer (the stated trade vs a hosted API), the documented
 * third-party fallback path, and what the credits ledger / KPI snapshots
 * actually store. Plain-language, not lawyered.
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <PublicHeader variant="default" />

      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
            Privacy
          </div>
          <h1 className="mt-3 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            What we do — and don&apos;t — know about you.
          </h1>
          <p className="mt-5 text-pretty text-base leading-relaxed text-[var(--fg-muted)]">
            Senda is a peer-to-peer mesh, so privacy here is a real
            trade-off, not a marketing line. This page is the plain-language
            version of how your data is handled. Last updated {UPDATED}.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-14">
          <div className="flex flex-col gap-10">
            <Clause title="No accounts, no identity">
              <p>
                You don&apos;t sign up, log in, or give us an email to chat.
                Sessions aren&apos;t tied to an identity. A peer serving your
                request doesn&apos;t know who you are unless your prompt itself
                reveals it.
              </p>
            </Clause>

            <Clause title="Your prompts go to a peer">
              <p>
                When you chat, your message travels over a TLS-encrypted
                connection to the mesh entry node and is routed to a peer that
                runs the requested open-weight model. That peer has to read the
                prompt to perform inference — this is the honest trade versus a
                hosted API, and we don&apos;t pretend otherwise. Every peer
                runs the same{" "}
                <a
                  href="https://github.com/senda-network/senda-llm"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  open-source runtime
                </a>
                , so what a peer can and can&apos;t do is auditable. For work
                you don&apos;t want to route through anyone else, you can{" "}
                <Link href="/download" className="text-[var(--accent)] hover:underline">
                  run your own node
                </Link>{" "}
                and keep the entire loop on your hardware.
              </p>
            </Clause>

            <Clause title="When the mesh can't serve a request">
              <p>
                If no live peer can serve a request, Senda may fall back
                to a third-party inference provider to complete it. Those
                requests are subject to that provider&apos;s terms and privacy
                policy. The source that served any response is exposed in the{" "}
                <code className="font-mono">x-senda-served-by</code>{" "}
                response header (<code className="font-mono">mesh</code> vs{" "}
                <code className="font-mono">fallback</code>) so it&apos;s never
                hidden from you.
              </p>
            </Clause>

            <Clause title="What we store">
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <span className="text-[var(--fg)]">Chat history</span> for the
                  web chat is kept locally in your browser, not on a server
                  account.
                </li>
                <li>
                  <span className="text-[var(--fg)]">Aggregate metrics</span> —
                  token counts, latency, which models served — are recorded as
                  periodic snapshots to power the public{" "}
                  <Link href="/status" className="text-[var(--accent)] hover:underline">
                    status
                  </Link>{" "}
                  and{" "}
                  <Link href="/metrics" className="text-[var(--accent)] hover:underline">
                    metrics
                  </Link>{" "}
                  pages. These are counts and timings, not the content of your
                  prompts.
                </li>
                <li>
                  <span className="text-[var(--fg)]">Standard request logs</span>{" "}
                  (such as IP address and user agent) may be processed
                  transiently by our hosting to serve traffic and prevent
                  abuse.
                </li>
                <li>
                  <span className="text-[var(--fg)]">The credits ledger</span>{" "}
                  stores contributors&apos; peer IDs and tokens served — not
                  chat content, and not tied to a personal identity.
                </li>
              </ul>
            </Clause>

            <Clause title="Verification never replays your prompts">
              <p>
                The mesh checks that a peer actually runs the model it
                advertises by replaying unpredictable{" "}
                <span className="text-[var(--fg)]">synthetic probes</span> and
                comparing fingerprints. Only those synthetic probes are
                replayed across the network — never your prompts.
              </p>
            </Clause>

            <Clause title="If you run a node">
              <p>
                Running a node contributes your machine&apos;s compute to the
                mesh. Your runtime announces its capabilities (models, backend,
                available memory) over the mesh, and your node&apos;s
                pseudonymous peer ID appears on the public status page. Other
                people&apos;s prompts pass through your machine to be served;
                you choose what models to run and can stop at any time.
              </p>
            </Clause>

            <Clause title="Optional diagnostic reports">
              <p>
                The desktop app can send{" "}
                <span className="text-[var(--fg)]">diagnostic reports</span>{" "}
                when something looks stuck — but only if you turn it on in
                Settings, or click &ldquo;Send diagnostic report&rdquo;
                yourself. A report contains app and runtime versions, your
                hardware class (backend and memory), which model was loading,
                and a scrubbed tail of the runtime&apos;s error log with home
                paths, usernames, and tokens removed. It is tagged with a
                random per-install id that isn&apos;t tied to your identity.
                It never includes your prompts or chat content. Automatic
                sending is off by default.
              </p>
            </Clause>

            <Clause title="Changes & contact">
              <p>
                Senda is under active development, so this policy will
                evolve as the product does — we&apos;ll update the date above
                when it changes. Questions or data requests: open an issue on{" "}
                <a
                  href="https://github.com/senda-network/senda-llm"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  GitHub
                </a>
                . See also the{" "}
                <Link href="/security" className="text-[var(--accent)] hover:underline">
                  security model
                </Link>{" "}
                and{" "}
                <Link href="/terms" className="text-[var(--accent)] hover:underline">
                  terms
                </Link>
                .
              </p>
            </Clause>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

function Clause({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
        {children}
      </div>
    </div>
  );
}
