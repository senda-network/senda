/**
 * The Senda mark: an "S-path". "Senda" (Sp. path/trail) drawn as a trail that
 * curves into an S, with waypoint nodes along it — the route a session takes
 * as it hops across peers in the mesh. Name (S for Senda), product (a path
 * through peer nodes), and letterform read at once. Re-used in the header, the
 * /about hero, the favicon (via desktop/icons/source.svg), and the matching
 * senda-llm/docs/senda-logo*.svg. Keep those in sync on any rebrand.
 */
export function Logo({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
    >
      <path
        d="M16.2 6.5 C13 4.4 8.4 5.2 8.4 9 C8.4 12.4 15.6 11.6 15.6 15 C15.6 18.8 11 19.6 7.8 17.5"
        stroke="var(--accent)"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.55"
        fill="none"
      />
      <circle cx="16.2" cy="6.5" r="2.05" fill="var(--accent)" />
      <circle cx="7.8" cy="17.5" r="2.05" fill="var(--accent)" />
      <circle cx="12" cy="12" r="1.6" fill="var(--accent)" />
    </svg>
  );
}
