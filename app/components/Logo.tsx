/**
 * The Senda mark: a leaf whose veins branch like paths across a network —
 * "senda" (Sp. path/trail) rendered as the routes a session takes. Green,
 * fresh, nature-leaning. Re-used in the header, the /about hero, the
 * favicon, and the matching senda-llm/docs/senda-logo.svg.
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
        d="M12 22 C5.5 17 4.8 8.8 12 2 C19.2 8.8 18.5 17 12 22 Z"
        fill="var(--accent)"
      />
      <path
        d="M12 21 L12 4.5 M12 15.5 L7.6 12.8 M12 15.5 L16.4 12.8 M12 10.5 L8.7 8.2 M12 10.5 L15.3 8.2"
        stroke="var(--bg-elev)"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}
