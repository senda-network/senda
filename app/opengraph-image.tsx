import { ImageResponse } from "next/og";

/**
 * The social share card for senda.network (og:image / twitter:image).
 * Composed with next/og so the wordmark + tagline stay crisp at any
 * scale, rendered in the brand's light/green language with the S-path mark.
 *
 * Uses the system sans stack only — no runtime font fetch — so link
 * previews stay reliable on Vercel's edge OG renderer.
 */
export const alt = "Senda — open-source AI, served by the people";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const mark = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M10.5 21.5 C 3.6 16.8 4.6 7.4 14.4 2.8 C 18.7 8.6 17.1 17.3 10.5 21.5 Z" fill="#1a9d5f"/><path d="M10.5 20.3 C 12.2 15 12 8.5 14 4" fill="none" stroke="#f6faf7" stroke-width="1.05" stroke-linecap="round" opacity="0.9"/><path d="M11.7 16 L15.3 13.8 M12.4 11.5 L16 9.2 M12 13.8 L8.2 12 M12.6 9 L9.2 7.2" fill="none" stroke="#f6faf7" stroke-width="1" stroke-linecap="round" opacity="0.85"/><circle cx="14" cy="3.8" r="0.9" fill="#f6faf7"/><circle cx="16" cy="9.2" r="0.9" fill="#f6faf7"/><circle cx="8.2" cy="12" r="0.9" fill="#f6faf7"/></svg>`,
  )}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "linear-gradient(135deg, #f6faf7 0%, #ffffff 45%, #eaf5ee 100%)",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -220,
            right: -160,
            width: 620,
            height: 620,
            borderRadius: 620,
            background:
              "radial-gradient(circle, rgba(26,157,95,0.20) 0%, rgba(26,157,95,0) 70%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} width={52} height={52} alt="" />
          <div
            style={{
              fontSize: 26,
              fontWeight: 600,
              color: "#11201a",
              letterSpacing: "-0.01em",
            }}
          >
            Senda
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "0.22em",
              color: "#1a9d5f",
              marginBottom: 20,
            }}
          >
PEER-TO-PEER LLM NETWORK
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 600,
              lineHeight: 1.08,
              color: "#11201a",
              letterSpacing: "-0.02em",
              whiteSpace: "pre-line",
            }}
          >
            {"Open-source AI,\nserved by the people."}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 400, color: "#55655c" }}>
            senda.network
          </div>
          <div style={{ fontSize: 22, fontWeight: 400, color: "#55665c" }}>
            No third-party AI provider · open source
          </div>
        </div>
      </div>
    ),
    size,
  );
}
