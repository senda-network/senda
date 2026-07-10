import { cn } from "./cn";

/**
 * A single labelled metric. Consolidates the many ad-hoc "label over value"
 * stat blocks across Dashboard, Mesh, and Machine surfaces.
 */
export function Stat({
  label,
  value,
  hint,
  align = "left",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn(align === "center" && "text-center", className)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--fg-muted)]">
        {label}
      </div>
      <div className="mt-1 text-[19px] font-semibold tracking-tight text-[var(--fg)] tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[12px] text-[var(--fg-subtle)]">{hint}</div>
      )}
    </div>
  );
}
