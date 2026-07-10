import { forwardRef } from "react";
import { cn } from "./cn";

/**
 * The single button primitive. Replaces the ~10 hand-rolled button classNames
 * scattered across the app. Variants map to the semantic token palette so both
 * light and dark themes stay correct automatically.
 */
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 font-medium select-none whitespace-nowrap " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-out)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-[var(--bg)] disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]";

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold shadow-[var(--shadow-accent)] hover:bg-[var(--accent-hover)]",
  secondary:
    "border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--fg)] hover:bg-[var(--bg-elev-2)] hover:border-[var(--border-strong)]",
  ghost: "text-[var(--fg-muted)] hover:bg-[var(--bg-elev-2)] hover:text-[var(--fg)]",
  danger:
    "border border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger)] hover:bg-[var(--danger)]/15",
};

const sizes: Record<Size, string> = {
  sm: "h-8 rounded-[var(--radius-md)] px-3 text-[13px]",
  md: "h-9 rounded-[var(--radius-lg)] px-4 text-sm",
  lg: "h-11 rounded-[var(--radius-lg)] px-5 text-[15px]",
  icon: "h-9 w-9 rounded-[var(--radius-lg)]",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
