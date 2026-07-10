import { cn } from "./cn";

/**
 * Compact status/label chips. `tone` maps to the semantic palette; `dot` adds
 * a leading status dot (used for live indicators). Badge is filled-soft; Pill
 * is a bordered, neutral container for counts and inline meta.
 */
type Tone = "neutral" | "accent" | "success" | "warn" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-[var(--bg-elev-2)] text-[var(--fg-muted)]",
  accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
  success: "bg-[var(--success-soft)] text-[var(--success)]",
  warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
  info: "bg-[var(--info-soft)] text-[var(--info)]",
};

const dotColors: Record<Tone, string> = {
  neutral: "bg-[var(--fg-subtle)]",
  accent: "bg-[var(--accent)]",
  success: "bg-[var(--success)]",
  warn: "bg-[var(--warn)]",
  danger: "bg-[var(--danger)]",
  info: "bg-[var(--info)]",
};

export function Badge({
  tone = "neutral",
  dot,
  pulse,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        toneClasses[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            dotColors[tone],
            pulse && "pulse-soft",
          )}
        />
      )}
      {children}
    </span>
  );
}

export function Pill({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-2.5 py-1 text-[11px] text-[var(--fg-muted)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
