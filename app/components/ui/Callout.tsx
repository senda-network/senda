import { cn } from "./cn";

/**
 * Inline advisory block for warnings/errors/info. Uses semantic soft
 * backgrounds so it reads correctly in both themes (fixing the old
 * amber-200/red-300-on-light contrast issues). Keep copy short; put depth
 * behind a link or a collapsible below.
 */
type Tone = "info" | "success" | "warn" | "danger" | "neutral";

const tones: Record<Tone, string> = {
  neutral: "border-[var(--border)] bg-[var(--bg-elev-2)] text-[var(--fg-muted)]",
  info: "border-[var(--info)]/25 bg-[var(--info-soft)] text-[var(--fg)]",
  success: "border-[var(--success)]/25 bg-[var(--success-soft)] text-[var(--fg)]",
  warn: "border-[var(--warn)]/30 bg-[var(--warn-soft)] text-[var(--fg)]",
  danger: "border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--fg)]",
};

const accentColor: Record<Tone, string> = {
  neutral: "text-[var(--fg-muted)]",
  info: "text-[var(--info)]",
  success: "text-[var(--success)]",
  warn: "text-[var(--warn)]",
  danger: "text-[var(--danger)]",
};

export function Callout({
  tone = "info",
  title,
  icon,
  action,
  className,
  children,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-[var(--radius-lg)] border px-4 py-3 text-[13px] leading-relaxed",
        tones[tone],
        className,
      )}
    >
      {icon && (
        <span className={cn("mt-0.5 shrink-0", accentColor[tone])}>{icon}</span>
      )}
      <div className="min-w-0 flex-1">
        {title && (
          <div className={cn("font-semibold", accentColor[tone])}>{title}</div>
        )}
        {children && (
          <div className="text-[var(--fg-muted)]">{children}</div>
        )}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
