import Link from "next/link";

/**
 * Site-wide early-access notice for the in-development mesh launch.
 * Rendered above the public nav on every page that uses `PublicHeader`.
 *
 * Sets honest expectations: dev mesh, variable latency, credits (not cash)
 * for contributors, no crypto token. Intentionally not dismissible — the
 * banner is part of the trust contract until we graduate from early access.
 */
export function EarlyAccessBanner() {
  return (
    <div className="border-b border-amber-400/25 bg-amber-400/10 px-4 py-2 text-center text-[11px] leading-relaxed text-[var(--fg-muted)] sm:text-[12px]">
      <span className="font-semibold text-amber-200">Early access.</span>{" "}
      The mesh is live and under active development — latency and uptime vary.{" "}
      <Link href="/contribute" className="text-[var(--accent)] hover:underline">
        Contributors earn credits
      </Link>{" "}
      (not cash yet).{" "}
      <Link href="/security" className="text-[var(--accent)] hover:underline">
        Security model →
      </Link>
    </div>
  );
}
