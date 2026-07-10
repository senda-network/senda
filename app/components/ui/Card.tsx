import { cn } from "./cn";

/**
 * Surface container. `elevated` adds a soft shadow; `inset` uses the deeper
 * elev-2 surface (for nested rows). Padding defaults to comfortable; pass
 * `padding="none"` when the content manages its own spacing.
 */
export function Card({
  className,
  elevated,
  inset,
  padding = "md",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  elevated?: boolean;
  inset?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}) {
  const pad =
    padding === "none"
      ? ""
      : padding === "sm"
        ? "p-4"
        : padding === "lg"
          ? "p-7"
          : "p-5";
  return (
    <div
      className={cn(
        "rounded-[var(--radius-2xl)] border border-[var(--border)]",
        inset ? "bg-[var(--bg-elev-2)]" : "bg-[var(--bg-elev)]",
        elevated && "shadow-[var(--shadow-md)]",
        pad,
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-[15px] font-semibold tracking-tight text-[var(--fg)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardEyebrow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]",
        className,
      )}
      {...props}
    />
  );
}
