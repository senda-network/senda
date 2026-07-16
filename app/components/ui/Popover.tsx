"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

type Coords = {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
};

/**
 * Lightweight anchored popover. Content is portaled to `document.body` with
 * `position: fixed` so it escapes parent stacking contexts (notably the
 * control shell header vs. sticky/blurred PageHeader — WKWebView otherwise
 * paints the page title over the Sharing tray). Closes on outside click or
 * Escape. For blocking surfaces use Panel/Dialog.
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
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [coords, setCoords] = useState<Coords | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    const next: Coords = {};

    if (side === "bottom") {
      next.top = rect.bottom + gap;
    } else {
      next.bottom = window.innerHeight - rect.top + gap;
    }

    if (align === "start") {
      next.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    } else if (align === "center") {
      const left = rect.left + rect.width / 2 - width / 2;
      next.left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    } else {
      next.right = Math.max(
        8,
        Math.min(window.innerWidth - rect.right, window.innerWidth - width - 8),
      );
    }

    setCoords(next);
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener("resize", onReposition);
    // Capture scroll from any nested scroller so the tray stays anchored.
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align, side, width]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (contentRef.current?.contains(t)) return;
      setOpen(false);
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

  const enterY = side === "top" ? 4 : -4;
  const originClass = side === "top" ? "origin-bottom" : "origin-top";

  return (
    <div ref={triggerRef} className={cn("relative inline-flex", className)}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                ref={contentRef}
                id={id}
                initial={{ opacity: 0, y: enterY, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: enterY, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, ...coords }}
                className={cn(
                  "fixed z-[100] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-elev)] shadow-[var(--shadow-lg)]",
                  originClass,
                  contentClassName,
                )}
              >
                {typeof children === "function"
                  ? children({ close: () => setOpen(false) })
                  : children}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
