import type { MetadataRoute } from "next";

/**
 * Allow crawling of the public marketing/transparency surface; keep the
 * machine-local controller pages and API routes out of the index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard",
        "/models",
        "/nodes",
        "/logs",
        "/settings",
      ],
    },
    sitemap: "https://closedmesh.com/sitemap.xml",
  };
}
