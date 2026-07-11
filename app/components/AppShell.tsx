"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "./Logo";
import { SharingControl } from "./SharingControl";
import { Setup } from "./Setup";
import { useSharing } from "../lib/use-control-status";
import { cn } from "./ui/cn";

/**
 * Chat-first control shell. A single slim top bar carries the brand (home →
 * chat), a labeled nav to every surface, and the global Sharing control. The
 * chat is the canvas beneath. Nav items are labeled (icon + text) on purpose —
 * an icon-only rail read as a row of cryptic glyphs.
 */
const NAV = [
  { href: "/chat", label: "Chat", icon: <IconChat /> },
  { href: "/dashboard", label: "Machine", icon: <IconMachine /> },
  { href: "/models", label: "Models", icon: <IconModels /> },
  { href: "/nodes", label: "Mesh", icon: <IconMesh /> },
  { href: "/logs", label: "Activity", icon: <IconActivity /> },
  { href: "/settings", label: "Settings", icon: <IconSettings /> },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const sharing = useSharing();

  // First-run gate: when the controller reports the runtime isn't installed yet
  // (and we're not the public deployment), the whole shell yields to Setup so
  // the chat home never loads against a mesh that doesn't exist. On success we
  // refresh and the normal shell takes over.
  if (sharing.control && !sharing.available && !sharing.publicDeployment) {
    return (
      <Setup
        onInstalled={() => {
          sharing.refresh();
          router.push("/chat");
        }}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--bg)]">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-elev)]/85 px-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-1">
          <Link
            href="/chat"
            className="flex items-center gap-2 rounded-[var(--radius-md)] px-1.5 py-1 transition-colors hover:bg-[var(--bg-elev-2)]"
          >
            <Logo />
            <span className="text-[13px] font-semibold tracking-tight text-[var(--fg)]">
              Senda
            </span>
          </Link>

          <div className="mx-1.5 h-5 w-px bg-[var(--border)]" />

          <nav className="flex items-center gap-0.5">
            {NAV.map((item) => {
              const active =
                item.href === "/chat"
                  ? pathname === "/chat"
                  : pathname === item.href ||
                    pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-[var(--fg-muted)] hover:bg-[var(--bg-elev-2)] hover:text-[var(--fg)]",
                  )}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <SharingControl />
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

// ---------- Icons (16px) ----------------------------------------------

function IconMachine() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 13.5h5M8 11v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconModels() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2L13.5 5v6L8 14 2.5 11V5L8 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M2.5 5L8 8l5.5-3M8 8v6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconMesh() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="3" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.3 4.2L7 11.5M11.7 4.2L9 11.5M4.5 3h7" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 3h10a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 3v-3H3a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 8h3l1.5-4 3 8L13 8h1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
