import { forwardRef } from "react";
import { cn } from "./cn";

const fieldBase =
  "w-full rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elev)] " +
  "px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] " +
  "transition-[border-color,box-shadow] duration-150 ease-[var(--ease-out)] " +
  "focus:outline-none focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/20 " +
  "disabled:opacity-50";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldBase, "resize-none leading-relaxed", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(fieldBase, "cursor-pointer pr-8", className)}
    {...props}
  />
));
Select.displayName = "Select";
