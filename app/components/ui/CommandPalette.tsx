"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
}

export interface CommandGroup {
  heading: string;
  items: CommandItem[];
}

/**
 * Cmd-K command palette — the primary way to reach secondary surfaces and run
 * quick actions (start/stop sharing, new chat, switch theme/model, open
 * Machine/Mesh/Models/Activity/Settings) without an always-on sidebar.
 */
export function CommandPalette({
  open,
  onClose,
  groups,
  placeholder = "Search actions and views…",
}: {
  open: boolean;
  onClose: () => void;
  groups: CommandGroup[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (it) =>
            !q ||
            it.label.toLowerCase().includes(q) ||
            it.hint?.toLowerCase().includes(q) ||
            it.keywords?.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const flat = useMemo(() => filtered.flatMap((g) => g.items), [filtered]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const run = (item: CommandItem) => {
    item.onSelect();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[active];
      if (item) run(item);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-lg overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--border)] bg-[var(--bg-elev)] shadow-[var(--shadow-lg)]"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className="text-[var(--fg-subtle)]"
              >
                <circle
                  cx="7"
                  cy="7"
                  r="4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M10.5 10.5L14 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                className="h-12 w-full bg-transparent text-[15px] text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:outline-none"
              />
            </div>
            <div
              ref={listRef}
              className="scrollbar-thin max-h-[52vh] overflow-y-auto p-2"
            >
              {flat.length === 0 && (
                <div className="px-3 py-8 text-center text-[13px] text-[var(--fg-muted)]">
                  No matches
                </div>
              )}
              {filtered.map((group) => (
                <div key={group.heading} className="mb-1">
                  <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--fg-subtle)]">
                    {group.heading}
                  </div>
                  {group.items.map((item) => {
                    const idx = flat.indexOf(item);
                    const isActive = idx === active;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseMove={() => setActive(idx)}
                        onClick={() => run(item)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-3 py-2 text-left text-[14px] transition-colors",
                          isActive
                            ? "bg-[var(--accent-soft)] text-[var(--fg)]"
                            : "text-[var(--fg-muted)]",
                        )}
                      >
                        {item.icon && (
                          <span
                            className={cn(
                              "flex h-5 w-5 items-center justify-center",
                              isActive ? "text-[var(--accent)]" : "text-[var(--fg-subtle)]",
                            )}
                          >
                            {item.icon}
                          </span>
                        )}
                        <span className="flex-1 text-[var(--fg)]">{item.label}</span>
                        {item.hint && (
                          <span className="text-[12px] text-[var(--fg-subtle)]">
                            {item.hint}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
