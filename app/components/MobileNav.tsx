"use client";

import Link from "next/link";
import { useState } from "react";

export type NavLink = { href: string; label: string };

/**
 * Hamburger menu for the public header on small screens. The desktop nav
 * collapses below `md`, so without this every link silently disappears on a
 * phone. Kept as a tiny client island so `PublicHeader` stays a server
 * component — only the open/close toggle needs interactivity. Closes on
 * navigation so the panel doesn't linger after a client-side route change.
 */
export function MobileNav({
  links,
  github,
}: {
  links: NavLink[];
  github: string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--fg)] transition hover:bg-[var(--bg-elev)]"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          {open ? (
            <>
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </>
          ) : (
            <>
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 border-b border-[var(--border)] bg-[var(--bg)] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.8)]">
          <nav className="mx-auto flex max-w-5xl flex-col px-4 py-3 text-[14px]">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={close}
                className="rounded-md px-3 py-2.5 text-[var(--fg-muted)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--fg)]"
              >
                {l.label}
              </Link>
            ))}
            <a
              href={github}
              target="_blank"
              rel="noreferrer"
              onClick={close}
              className="rounded-md px-3 py-2.5 text-[var(--fg-muted)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--fg)]"
            >
              Runtime on GitHub
            </a>
          </nav>
        </div>
      )}
    </div>
  );
}
