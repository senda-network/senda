"use client";

import { useEffect, useState } from "react";
import { MODEL_CATALOG, type CatalogModel } from "./model-catalog";

type CatalogResponse = {
  ok: true;
  catalog: CatalogModel[];
  fetchedAt: string;
};

type StoredCatalog = {
  catalog: CatalogModel[];
  fetchedAt: string;
};

// Bumped v1 → v2 (May 2026) when the ~17–20 GB pool-friendly tier was
// added. The TTL below means a v1 client could otherwise sit on its stale
// catalog for up to an hour after each /api/catalog change; bumping the
// key forces a one-shot invalidation so new models show up immediately.
const LS_KEY = "closedmesh:catalog-cache:v2";
// The canonical catalog lives on the public site. The desktop app's
// bundled controller fetches it directly from the browser — no local
// proxy — so adding a new model is just `vercel --prod`.
const CATALOG_URL = "https://closedmesh.com/api/catalog";
// Re-fetch at most once an hour. localStorage gives subsequent dashboard
// loads a non-bundled first paint; the network fetch in the background
// keeps it fresh on long-running sessions.
const REFETCH_AFTER_MS = 60 * 60 * 1000;

function readStored(): StoredCatalog | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCatalog>;
    if (!parsed || !Array.isArray(parsed.catalog)) return null;
    if (typeof parsed.fetchedAt !== "string") return null;
    return { catalog: parsed.catalog, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeStored(value: StoredCatalog): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(value));
  } catch {
    // private mode / quota — fine, we'll just refetch next time
  }
}

/**
 * Canonical display order: ascending memory footprint, ties broken by
 * model name. We sort here (not in `MODEL_CATALOG` or the API) so the
 * order is the same whether the catalog came from the bundle, the
 * localStorage cache, or a fresh `/api/catalog` fetch — every consumer
 * of `useCatalog` gets it for free.
 */
function sortCatalog(catalog: CatalogModel[]): CatalogModel[] {
  return [...catalog].sort((a, b) => {
    if (a.minVramGb !== b.minVramGb) return a.minVramGb - b.minVramGb;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Pull the model catalog from `/api/catalog` so the desktop app picks up
 * new models without waiting for a release.
 *
 * The first paint is always synchronous: we render with the localStorage
 * cache from the previous visit, falling back to the bundled
 * {@link MODEL_CATALOG} on a fresh install. Once the network fetch returns
 * we swap in the latest catalog and persist it for next time.
 *
 * Failures are silent — the bundled / cached copy is the safety net, and
 * the dashboard never gets stuck waiting on the network for catalog data.
 */
export function useCatalog(): {
  catalog: CatalogModel[];
  source: "bundled" | "cached" | "remote";
} {
  const [state, setState] = useState<{
    catalog: CatalogModel[];
    source: "bundled" | "cached" | "remote";
  }>(() => {
    const stored = readStored();
    if (stored && stored.catalog.length > 0) {
      return { catalog: sortCatalog(stored.catalog), source: "cached" };
    }
    return { catalog: sortCatalog(MODEL_CATALOG), source: "bundled" };
  });

  useEffect(() => {
    const stored = readStored();
    const fresh =
      stored && Date.now() - new Date(stored.fetchedAt).getTime() < REFETCH_AFTER_MS;
    if (fresh) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(CATALOG_URL, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as CatalogResponse;
        if (cancelled) return;
        if (!Array.isArray(data.catalog) || data.catalog.length === 0) return;
        writeStored({
          catalog: data.catalog,
          fetchedAt: new Date().toISOString(),
        });
        setState({ catalog: sortCatalog(data.catalog), source: "remote" });
      } catch {
        // offline / closedmesh.com down — keep whatever we already have
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
