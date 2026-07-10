"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Logo } from "./Logo";
import { SharingControl } from "./SharingControl";
import { Setup } from "./Setup";
import { useSharing } from "../lib/use-control-status";
import { setTheme } from "../lib/theme";
import {
  CommandPalette,
  type CommandGroup,
} from "./ui/CommandPalette";
import { Tooltip } from "./ui/Tooltip";
import { cn } from "./ui/cn";

/**
 * Chat-first control shell. A single slim top bar carries the brand (home →
 * chat), the global Sharing control, a quiet icon rail to the secondary
 * surfaces, and the Cmd-K command palette. The old 6-item sidebar is gone; the
 * chat is the canvas beneath.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const sharing = useSharing();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rail = useMemo(
    () => [
      { href: "/dashboard", label: "Machine", icon: <IconMachine /> },
      { href: "/models", label: "Models", icon: <IconModels /> },
      { href: "/nodes", label: "Mesh", icon: <IconMesh /> },
      { href: "/logs", label: "Activity", icon: <IconActivity /> },
      { href: "/settings", label: "Settings", icon: <IconSettings /> },
    ],
    [],
  );

  const newChat = () => {
    window.dispatchEvent(new CustomEvent("senda:new-chat"));
    if (pathname !== "/chat") router.push("/chat");
  };

  const groups: CommandGroup[] = useMemo(() => {
    const go: CommandGroup = {
      heading: "Go to",
      items: [
        { id: "go-chat", label: "Chat", icon: <IconChat />, keywords: "home talk mesh", onSelect: () => router.push("/chat") },
        { id: "go-machine", label: "Machine", icon: <IconMachine />, keywords: "dashboard node health status", onSelect: () => router.push("/dashboard") },
        { id: "go-models", label: "Models", icon: <IconModels />, keywords: "download catalog", onSelect: () => router.push("/models") },
        { id: "go-mesh", label: "Mesh", icon: <IconMesh />, keywords: "nodes network peers topology", onSelect: () => router.push("/nodes") },
        { id: "go-activity", label: "Activity", icon: <IconActivity />, keywords: "logs errors", onSelect: () => router.push("/logs") },
        { id: "go-settings", label: "Settings", icon: <IconSettings />, keywords: "preferences autostart theme", onSelect: () => router.push("/settings") },
      ],
    };
    const actions: CommandGroup = {
      heading: "Actions",
      items: [
        { id: "new-chat", label: "New chat", hint: "⌘⇧O", keywords: "clear thread reset", onSelect: newChat },
        ...(sharing.publicDeployment
          ? []
          : sharing.running
            ? [{ id: "stop", label: "Stop sharing", keywords: "runtime node off", onSelect: () => sharing.stop() }]
            : [{ id: "start", label: "Start sharing", keywords: "runtime node on serve", onSelect: () => sharing.start() }]),
      ],
    };
    const theme: CommandGroup = {
      heading: "Theme",
      items: [
        { id: "theme-system", label: "Theme: System", onSelect: () => setTheme("system") },
        { id: "theme-light", label: "Theme: Light", onSelect: () => setTheme("light") },
        { id: "theme-dark", label: "Theme: Dark", onSelect: () => setTheme("dark") },
      ],
    };
    return [go, actions, theme];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, pathname, sharing.running, sharing.publicDeployment]);

  // First-run gate: when the controller reports the runtime isn't installed yet
  // (and we're not the public deployment), the whole shell yields to Setup so
  // the chat home never loads against a mesh that doesn't exist. On success we
  // refresh and the normal shell takes over.
  if (
    sharing.control &&
    !sharing.available &&
    !sharing.publicDeployment
  ) {
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
        <Link
          href="/chat"
          className="flex items-center gap-2 rounded-[var(--radius-md)] px-1.5 py-1 transition-colors hover:bg-[var(--bg-elev-2)]"
        >
          <Logo />
          <span className="text-[13px] font-semibold tracking-tight text-[var(--fg)]">
            Senda
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          <SharingControl />

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          <nav className="flex items-center gap-0.5">
            {rail.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Tooltip key={item.href} label={item.label} side="bottom">
                  <Link
                    href={item.href}
                    aria-label={item.label}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] transition-colors",
                      active
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--fg-muted)] hover:bg-[var(--bg-elev-2)] hover:text-[var(--fg)]",
                    )}
                  >
                    {item.icon}
                  </Link>
                </Tooltip>
              );
            })}
          </nav>

          <Tooltip label="Search · ⌘K" side="bottom">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
              className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elev)] px-2 text-[var(--fg-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
            >
              <IconSearch />
              <span className="hidden font-mono text-[10px] sm:inline">⌘K</span>
            </button>
          </Tooltip>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        groups={groups}
      />
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

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
