"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { cn } from "./cn";

/**
 * Slide-over panel used for secondary surfaces (Machine, Mesh, Models,
 * Activity) so they overlay the chat home without a hard navigation. Backdrop
 * dims and blurs; Escape and backdrop click close. Content scrolls.
 */
export function Panel({
  open,
  onClose,
  title,
  subtitle,
  actions,
  side = "right",
  width = 480,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  side?: "right" | "left";
  width?: number;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const offscreen = side === "right" ? width : -width;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          />
          <motion.aside
            initial={{ x: offscreen }}
            animate={{ x: 0 }}
            exit={{ x: offscreen }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            style={{ width }}
            className={cn(
              "absolute top-0 bottom-0 flex max-w-[92vw] flex-col border-[var(--border)] bg-[var(--bg)] shadow-[var(--shadow-lg)]",
              side === "right" ? "right-0 border-l" : "left-0 border-r",
            )}
          >
            {(title || actions) && (
              <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
                <div className="min-w-0">
                  {title && (
                    <h2 className="text-[15px] font-semibold tracking-tight text-[var(--fg)]">
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p className="mt-0.5 text-[13px] text-[var(--fg-muted)]">
                      {subtitle}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {actions}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-muted)] transition hover:bg-[var(--bg-elev-2)] hover:text-[var(--fg)]"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              </header>
            )}
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
