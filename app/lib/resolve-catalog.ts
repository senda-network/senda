import { MODEL_CATALOG, type CatalogModel } from "./model-catalog";
import {
  mapRuntimeCatalog,
  type RuntimeCatalogEntry,
} from "./catalog-merge";

function trimmedEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Resolve the live catalog the same way `GET /api/catalog` does: fetch the
 * runtime's listed set and enrich with site display copy, falling back to the
 * bundled snapshot when the runtime is unreachable or too old.
 *
 * Shared by the public catalog route and server gates (e.g. chat vision) so
 * both stay on one merge path.
 */
export async function resolveCatalog(): Promise<CatalogModel[]> {
  const adminUrl =
    trimmedEnv("SENDA_ADMIN_URL", "MESH_CONSOLE_URL") ?? "http://127.0.0.1:3131";
  const token = trimmedEnv("SENDA_RUNTIME_TOKEN") ?? "";
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  try {
    const res = await fetch(`${adminUrl}/api/catalog`, {
      cache: "no-store",
      headers,
    });
    if (!res.ok) return MODEL_CATALOG;
    const data = (await res.json()) as { catalog?: RuntimeCatalogEntry[] };
    if (!Array.isArray(data.catalog) || data.catalog.length === 0) {
      return MODEL_CATALOG;
    }
    const mapped = mapRuntimeCatalog(data.catalog, MODEL_CATALOG);
    return mapped.length > 0 ? mapped : MODEL_CATALOG;
  } catch {
    return MODEL_CATALOG;
  }
}
