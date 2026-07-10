"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "./cn";

/**
 * iOS-style segmented control with a sliding selection pill. Used for the
 * theme switch (System/Light/Dark) and other small either/or choices.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode }[];
  size?: "sm" | "md";
  className?: string;
}) {
  const layoutId = useId();
  const pad = size === "sm" ? "p-0.5" : "p-1";
  const cell = size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]";
  return (
    <div
      className={cn(
        "inline-flex rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elev-2)]",
        pad,
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative rounded-[var(--radius-md)] font-medium transition-colors duration-150",
              cell,
              active ? "text-[var(--fg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${layoutId}`}
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
                className="absolute inset-0 rounded-[var(--radius-md)] bg-[var(--bg-elev)] shadow-[var(--shadow-sm)]"
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
