/**
 * Presentational marketing building blocks shared between the public
 * homepage (`/`) and the long-form `/about` page. These were previously
 * defined inline in `/about`; they're hoisted here so the homepage can
 * reuse the exact same cards, steps, and architecture diagram instead of
 * forking the copy and drifting out of sync.
 *
 * All of these are pure server components — no client interactivity — so
 * they can be rendered from either a server or client parent.
 */
import Image from "next/image";

/**
 * Full-bleed artwork band that punctuates the homepage as you scroll. The
 * pieces are abstract "path through a living network" studies (leaf-vein
 * routes, node constellations) in the brand green, generated to extend the
 * rebrand past a recolor into a visual language. The top/bottom gradient
 * feathers each image into the page background so it reads as part of the
 * page, not a pasted-in rectangle.
 *
 * Pass `srcDark` for a dark-theme twin: both are rendered and CSS reveals the
 * one matching the resolved theme (see `.theme-light-only`/`.theme-dark-only`
 * in globals.css). This keeps the component a pure server component with no
 * hydration flash on system-dark.
 */
export function ArtBand({
  src,
  srcDark,
  alt,
  priority = false,
  className,
}: {
  src: string;
  srcDark?: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden bg-[var(--bg)] ${
        className ?? "h-56 sm:h-72 lg:h-80"
      }`}
    >
      {srcDark ? (
        <>
          <div className="absolute inset-0 theme-light-only">
            <Image
              src={src}
              alt={alt}
              fill
              priority={priority}
              sizes="100vw"
              className="object-cover object-center"
            />
          </div>
          <div className="absolute inset-0 theme-dark-only">
            <Image
              src={srcDark}
              alt={alt}
              fill
              priority={priority}
              sizes="100vw"
              className="object-cover object-center"
            />
          </div>
        </>
      ) : (
        <Image
          src={src}
          alt={alt}
          fill
          priority={priority}
          sizes="100vw"
          className="object-cover object-center"
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, var(--bg) 0%, transparent 16%, transparent 84%, var(--bg) 100%)",
        }}
      />
    </div>
  );
}

export function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-6">
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-muted)]">
        {body}
      </p>
    </div>
  );
}

export function FitCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-6">
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <ul className="mt-4 flex flex-col gap-2.5 text-[14px] leading-relaxed text-[var(--fg)]/90">
        {items.map((it) => (
          <li key={it} className="flex gap-2.5">
            <span
              className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]"
              aria-hidden
            />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NumberedStep({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] text-[var(--accent)]">
          0{n}
        </span>
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-muted)]">
        {body}
      </p>
    </div>
  );
}

export function ArchitectureDiagram() {
  const accent = "var(--accent)";
  const fg = "var(--fg)";
  const fgMuted = "var(--fg-muted)";
  const elev = "var(--bg-elev)";
  const border = "var(--border)";

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-6 sm:p-10">
      <svg
        viewBox="0 0 880 320"
        className="h-auto w-full"
        role="img"
        aria-label="Senda architecture: chat clients to mesh entry point to peer compute"
      >
        <defs>
          <marker
            id="cm-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={fgMuted} />
          </marker>
        </defs>

        {/* Browser */}
        <g>
          <rect
            x="20"
            y="100"
            width="180"
            height="120"
            rx="14"
            fill={elev}
            stroke={border}
          />
          <text
            x="110"
            y="135"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="13"
            fontWeight={600}
            fill={fg}
          >
            Chat client
          </text>
          <text
            x="110"
            y="158"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="11"
            fill={fgMuted}
          >
            senda.network
          </text>
          <text
            x="110"
            y="190"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="11"
            fill={fgMuted}
          >
            or desktop app
          </text>
        </g>

        {/* Arrow 1 */}
        <line
          x1="200"
          y1="160"
          x2="298"
          y2="160"
          stroke={fgMuted}
          strokeWidth="1.5"
          markerEnd="url(#cm-arrow)"
        />
        <text
          x="249"
          y="148"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="10"
          fill={fgMuted}
        >
          /api/chat
        </text>

        {/* Local controller */}
        <g>
          <rect
            x="300"
            y="100"
            width="200"
            height="120"
            rx="14"
            fill={elev}
            stroke={border}
          />
          <text
            x="400"
            y="135"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="13"
            fontWeight={600}
            fill={fg}
          >
            Mesh entry
          </text>
          <text
            x="400"
            y="158"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="11"
            fill={fgMuted}
          >
            OpenAI-compatible /v1
          </text>
          <text
            x="400"
            y="190"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="11"
            fill={fgMuted}
          >
            capability-aware router
          </text>
        </g>

        {/* Arrow 2 */}
        <line
          x1="500"
          y1="160"
          x2="598"
          y2="160"
          stroke={fgMuted}
          strokeWidth="1.5"
          markerEnd="url(#cm-arrow)"
        />
        <text
          x="549"
          y="148"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="10"
          fill={fgMuted}
        >
          /v1
        </text>

        {/* Mesh group */}
        <g>
          <rect
            x="600"
            y="40"
            width="260"
            height="240"
            rx="14"
            fill="transparent"
            stroke={border}
            strokeDasharray="4 4"
          />
          <text
            x="730"
            y="62"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="11"
            fill={fgMuted}
          >
            Senda LLM peers
          </text>

          {/* Three peer dots with center hub */}
          {/* center hub */}
          <circle cx="730" cy="170" r="6" fill={fg} opacity="0.85" />
          {/* peers */}
          <circle cx="730" cy="100" r="9" fill={accent} />
          <circle cx="660" cy="220" r="9" fill={accent} />
          <circle cx="800" cy="220" r="9" fill={accent} />
          {/* mesh edges */}
          <line
            x1="730"
            y1="109"
            x2="730"
            y2="164"
            stroke={fg}
            strokeOpacity="0.5"
            strokeWidth="1.2"
          />
          <line
            x1="668"
            y1="214"
            x2="724"
            y2="174"
            stroke={fg}
            strokeOpacity="0.5"
            strokeWidth="1.2"
          />
          <line
            x1="792"
            y1="214"
            x2="736"
            y2="174"
            stroke={fg}
            strokeOpacity="0.5"
            strokeWidth="1.2"
          />
          {/* peer labels */}
          <text
            x="730"
            y="86"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="10"
            fill={fgMuted}
          >
            M-series Mac
          </text>
          <text
            x="660"
            y="246"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="10"
            fill={fgMuted}
          >
            CUDA · 4090
          </text>
          <text
            x="800"
            y="246"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="10"
            fill={fgMuted}
          >
            Vulkan laptop
          </text>
        </g>
      </svg>
    </div>
  );
}
