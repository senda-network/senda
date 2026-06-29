import type { MetadataRoute } from "next";

/**
 * Public sitemap. Marketing + transparency surfaces only — the local
 * controller pages (`/dashboard`, `/models`, …) are machine-local and
 * excluded via `robots.ts`.
 */
const BASE = "https://closedmesh.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: Array<{ path: string; priority: number }> = [
    { path: "/", priority: 1 },
    { path: "/contribute", priority: 0.9 },
    { path: "/download", priority: 0.9 },
    { path: "/docs", priority: 0.8 },
    { path: "/about", priority: 0.7 },
    { path: "/security", priority: 0.7 },
    { path: "/status", priority: 0.6 },
    { path: "/metrics", priority: 0.6 },
    { path: "/updates", priority: 0.6 },
    { path: "/privacy", priority: 0.3 },
    { path: "/terms", priority: 0.3 },
  ];
  return routes.map(({ path, priority }) => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority,
  }));
}
