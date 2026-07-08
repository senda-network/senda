import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "../../components/PublicHeader";
import { PublicFooter } from "../../components/PublicFooter";

export const metadata: Metadata = {
  title: "Terms — Senda",
  description:
    "The terms for using Senda during early access: as-is availability, acceptable use, how credits work (illustrative, not cash), and the responsibilities of contributors who run nodes.",
};

const UPDATED = "June 29, 2026";

/**
 * /terms — short, honest terms of use that match the early-access reality:
 * as-is, no warranty, credits are illustrative (not cash, no token),
 * acceptable-use limits, and the responsibilities a node contributor takes
 * on. Plain-language, intentionally not over-lawyered for the stage.
 */
export default function TermsPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <PublicHeader variant="default" />

      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
            Terms
          </div>
          <h1 className="mt-3 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            The deal, in plain language.
          </h1>
          <p className="mt-5 text-pretty text-base leading-relaxed text-[var(--fg-muted)]">
            By using Senda — the web chat, the API, or by running a node —
            you agree to the terms below. Senda is in early access and
            these will evolve with the product. Last updated {UPDATED}.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-14">
          <div className="flex flex-col gap-10">
            <Clause title="Early access, provided as-is">
              <p>
                The mesh is live and under active development. Availability,
                latency, which models are served, and the feature set can
                change or break at any time. The service is provided
                &quot;as is&quot; and &quot;as available,&quot; without
                warranties of any kind. Don&apos;t rely on it for anything
                safety-, finance-, legal-, or health-critical.
              </p>
            </Clause>

            <Clause title="Model outputs">
              <p>
                Senda serves open-weight models. Their outputs can be
                inaccurate, incomplete, or offensive, and do not constitute
                professional advice. You&apos;re responsible for reviewing and
                how you use anything the models generate.
              </p>
            </Clause>

            <Clause title="Acceptable use">
              <p>You agree not to use Senda to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>break the law or generate content that is illegal where you are;</li>
                <li>
                  attack, overload, or disrupt the mesh, the entry node, or any
                  peer — including attempts to de-anonymize peers or users;
                </li>
                <li>
                  generate content that exploits or harms minors, or that
                  facilitates serious harm to people;
                </li>
                <li>
                  misrepresent the source of a model&apos;s output or
                  circumvent the verification and routing controls.
                </li>
              </ul>
            </Clause>

            <Clause title="Credits are illustrative">
              <p>
                Contributors accumulate{" "}
                <Link href="/contribute" className="text-[var(--accent)] hover:underline">
                  credits
                </Link>{" "}
                for completion tokens served to the mesh. During early access
                credits are illustrative — they are{" "}
                <span className="text-[var(--fg)]">not cash</span>, not a
                financial instrument, and not a crypto token, and carry no
                guarantee of future monetary value. How they work may change as
                paid inference and payouts are built.
              </p>
            </Clause>

            <Clause title="If you run a node">
              <p>
                Running a node is voluntary and at your own risk. You are
                responsible for your own hardware, electricity, network, and
                for complying with the laws that apply to you. By serving the
                mesh you accept that other users&apos; prompts will be processed
                on your machine to generate responses. You can stop serving at
                any time.
              </p>
            </Clause>

            <Clause title="Limitation of liability">
              <p>
                To the maximum extent permitted by law, Senda and its
                contributors are not liable for any indirect, incidental, or
                consequential damages, or for any loss arising from your use of
                the service, the mesh, model outputs, or running a node.
              </p>
            </Clause>

            <Clause title="Changes">
              <p>
                We may change, suspend, or discontinue any part of the service,
                and we may update these terms — the date above reflects the
                latest version. Continued use after a change means you accept
                it. Questions: open an issue on{" "}
                <a
                  href="https://github.com/senda-network/senda-llm"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  GitHub
                </a>
                . See also our{" "}
                <Link href="/privacy" className="text-[var(--accent)] hover:underline">
                  privacy policy
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
