/**
 * Sticky page header used across control routes for title/subtitle. The global
 * top bar (AppShell) now owns live status and the Sharing control, so this no
 * longer renders a StatusPill by default — pass `actions` only for page-local
 * controls.
 *
 * Visual rules (kept consistent so the app feels of-a-piece):
 *   - Subtle ambient accent glow at the top of each page, fading out at ~120px.
 *   - Title in semibold + tight tracking; subtitle is muted.
 *   - Optional `eyebrow` for a small uppercase label above the title.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, rgba(26,157,95,0.10), transparent 70%)",
        }}
      />
      <div className="relative flex h-14 items-center justify-between gap-4 px-6">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
              {eyebrow}
            </div>
          )}
          <div className="truncate text-base font-semibold tracking-tight text-[var(--fg)]">
            {title}
          </div>
          {subtitle && (
            <div className="truncate text-[12px] text-[var(--fg-muted)]">
              {subtitle}
            </div>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
