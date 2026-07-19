import { type CatalogModel } from "./model-catalog";

/**
 * One entry as returned by the runtime's `GET /api/catalog`. The runtime owns
 * *which* models are offered (its `listed` set); the website owns curated
 * display copy. This module merges the two.
 */
export type RuntimeCatalogEntry = {
  id?: string;
  size?: string;
  sizeGb?: number;
  description?: string;
  draft?: string | null;
  vision?: boolean;
  moe?: boolean;
  listed?: boolean;
};

export function inferFamily(id: string): CatalogModel["family"] {
  const lower = id.toLowerCase();
  if (lower.includes("qwen")) return "qwen";
  if (lower.includes("llama")) return "llama";
  if (lower.includes("gemma")) return "gemma";
  if (lower.includes("deepseek")) return "deepseek";
  if (lower.includes("glm")) return "glm";
  if (lower.includes("phi")) return "phi";
  if (
    lower.includes("mistral") ||
    lower.includes("mixtral") ||
    lower.includes("devstral")
  ) {
    return "mistral";
  }
  return "qwen";
}

// Rough usable-VRAM estimate for a runtime-listed model the site has no curated
// entry for yet. Mirrors the runtime's size × 1.1 auto-serve heuristic, rounded
// up, so a brand-new model still renders a sensible fit hint before the site
// snapshot gains a hand-tuned `minVramGb`.
export function estimateVram(sizeGb: number): number {
  return Math.max(1, Math.ceil(sizeGb * 1.15));
}

/**
 * Turn the runtime's catalog list into the website's `CatalogModel[]`.
 *
 * For each runtime entry we prefer the site's curated snapshot row when the id
 * is recognised (keeps display name, description, tier fit, recommended flag),
 * and otherwise synthesise a minimal row from the runtime's own fields so a
 * newly-listed model appears without waiting for a website deploy.
 */
export function mapRuntimeCatalog(
  entries: RuntimeCatalogEntry[],
  snapshot: CatalogModel[],
): CatalogModel[] {
  const byId = new Map(snapshot.map((m) => [m.id, m]));
  const mapped: CatalogModel[] = [];
  for (const entry of entries) {
    if (!entry.id) continue;
    const curated = byId.get(entry.id);
    if (curated) {
      // Runtime owns capability flags (vision); site owns display copy.
      // When the runtime omits `vision` (older builds), keep the curated flag.
      mapped.push({
        ...curated,
        vision: resolveVisionFlag(entry.vision, curated.vision),
      });
      continue;
    }
    const sizeGb = typeof entry.sizeGb === "number" ? entry.sizeGb : 0;
    mapped.push({
      id: entry.id,
      name: entry.id,
      family: inferFamily(entry.id),
      sizeGb,
      minVramGb: estimateVram(sizeGb),
      description: entry.description ?? "",
      vision: resolveVisionFlag(entry.vision, undefined),
    });
  }
  return mapped;
}

/** Runtime `vision` wins when explicitly set; otherwise fall back to curated. */
export function resolveVisionFlag(
  runtimeVision: boolean | undefined,
  curatedVision: boolean | undefined,
): true | undefined {
  if (runtimeVision === true) return true;
  if (runtimeVision === false) return undefined;
  return curatedVision ? true : undefined;
}
