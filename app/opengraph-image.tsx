import { ImageResponse } from "next/og";

/**
 * The social share card for senda.network (og:image / twitter:image).
 * Composed with next/og so the wordmark + tagline stay crisp at any
 * scale, rendered in the brand's light/green language with the leaf mark.
 *
 * Uses the system sans stack only — no runtime font fetch — so link
 * previews stay reliable on Vercel's edge OG renderer.
 */
export const alt = "Senda — your private LLM, on hardware people own";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const leaf = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 22 C5.5 17 4.8 8.8 12 2 C19.2 8.8 18.5 17 12 22 Z" fill="#1a9d5f"/><path d="M12 21 L12 4.5 M12 15.5 L7.6 12.8 M12 15.5 L16.4 12.8 M12 10.5 L8.7 8.2 M12 10.5 L15.3 8.2" stroke="#eafaf1" stroke-width="1.1" stroke-linecap="round" fill="none" opacity="0.9"/></svg>`,
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
          <img src={leaf} width={52} height={52} alt="" />
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
            OPEN PEER-TO-PEER LLM MESH
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
            {"Your private LLM,\non hardware people own."}
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
