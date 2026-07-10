/**
 * The Senda mark: a leaf whose midrib and veins branch like routes across a
 * network, with three waypoint nodes at the vein tips — the paths a session
 * takes as it hops across peers in the mesh. "Senda" (Sp. path/trail) read as
 * a living leaf; the three nodes echo the original mesh mark. Re-used in the
 * header, the /about hero, the favicon (via desktop/icons/source.svg), the
 * social card (app/opengraph-image.tsx), and senda-llm/docs/senda-logo*.svg.
 * Keep those in sync on any rebrand.
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
        d="M10.5 21.5 C 3.6 16.8 4.6 7.4 14.4 2.8 C 18.7 8.6 17.1 17.3 10.5 21.5 Z"
        fill="var(--accent)"
      />
      <path
        d="M10.5 20.3 C 12.2 15 12 8.5 14 4"
        stroke="var(--bg-elev)"
        strokeWidth="1.05"
        strokeLinecap="round"
        opacity="0.9"
        fill="none"
      />
      <path
        d="M11.7 16 L15.3 13.8 M12.4 11.5 L16 9.2 M12 13.8 L8.2 12 M12.6 9 L9.2 7.2"
        stroke="var(--bg-elev)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.85"
        fill="none"
      />
      <circle cx="14" cy="3.8" r="0.9" fill="var(--bg-elev)" />
      <circle cx="16" cy="9.2" r="0.9" fill="var(--bg-elev)" />
      <circle cx="8.2" cy="12" r="0.9" fill="var(--bg-elev)" />
    </svg>
  );
}
