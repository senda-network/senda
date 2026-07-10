"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "./cn";

/**
 * Lightweight anchored popover. Renders content absolutely relative to the
 * trigger wrapper; closes on outside click or Escape. For simple menus and
 * detail flyouts (Sharing health, model switcher). Not a modal — for blocking
 * surfaces use Panel/Dialog.
 */
export function Popover({
  trigger,
  children,
  align = "end",
  side = "bottom",
  width = 280,
  className,
  contentClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: (args: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode | ((args: { close: () => void }) => React.ReactNode);
  align?: "start" | "end" | "center";
  side?: "top" | "bottom";
  width?: number;
  className?: string;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (controlledOpen === undefined) setUncontrolled(v);
  };
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const alignClass =
    align === "start"
      ? "left-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "right-0";
  const sideClass =
    side === "top"
      ? "bottom-[calc(100%+8px)] origin-bottom"
      : "top-[calc(100%+8px)] origin-top";
  const enterY = side === "top" ? 4 : -4;

  return (
    <div ref={ref} className={cn("relative inline-flex", className)}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            initial={{ opacity: 0, y: enterY, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: enterY, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            style={{ width }}
            className={cn(
              "absolute z-50 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-elev)] shadow-[var(--shadow-lg)]",
              sideClass,
              alignClass,
              contentClassName,
            )}
          >
            {typeof children === "function"
              ? children({ close: () => setOpen(false) })
              : children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
