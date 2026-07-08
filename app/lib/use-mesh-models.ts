"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "./runtime-target";
import type { MeshFit, MeshModel, SplitKind } from "./use-mesh-status";

/**
 * Wire shape of `MeshModelPayload` from
 * `senda-llm/senda/src/api/status.rs`. The runtime emits more
 * fields than the chat product cares about (ranking_source, draft_model,
 * etc.); only the ones consumed by the UI are typed here so the schema
 * stays small.
 */
type RuntimeMeshFit = {
  fits_on_largest_node: boolean;
  fits_pooled: boolean;
  pooled_vram_gb: number;
  needed_vram_gb: number;
  eligible_peer_count: number;
};

type RuntimeMeshModel = {
  name: string;
  display_name?: string;
  status?: string;
  node_count?: number;
  mesh_vram_gb?: number;
  size_gb?: number;
  moe?: boolean;
  expert_count?: number | null;
  used_expert_count?: number | null;
  active_nodes?: string[];
  /** Phase A additions — older runtimes (<0.66) won't emit these. */
  split_kind?: string;
  mesh_fit?: RuntimeMeshFit;
};

const DEFAULT_FIT: MeshFit = {
  fitsOnLargestNode: false,
  fitsPooled: false,
  pooledVramGb: 0,
  neededVramGb: 0,
  eligiblePeerCount: 0,
};

function normalizeSplitKind(raw: string | undefined): SplitKind {
  switch (raw) {
    case "solo":
    case "pipeline":
    case "moe":
    case "multi_host":
    case "cold":
      return raw;
    default:
      // Default to `cold` — older runtimes emit no split_kind, and "cold"
      // is the safest assumption for "we don't know if anyone's serving
      // this" since it triggers the conservative UI path.
      return "cold";
  }
}

function normalizeMeshFit(raw: RuntimeMeshFit | undefined): MeshFit {
  if (!raw) return DEFAULT_FIT;
  return {
    fitsOnLargestNode: raw.fits_on_largest_node ?? false,
    fitsPooled: raw.fits_pooled ?? false,
    pooledVramGb: raw.pooled_vram_gb ?? 0,
    neededVramGb: raw.needed_vram_gb ?? 0,
    eligiblePeerCount: raw.eligible_peer_count ?? 0,
  };
}

function normalizeMeshModel(raw: RuntimeMeshModel): MeshModel {
  return {
    name: raw.name,
    displayName: raw.display_name ?? raw.name,
    status: raw.status ?? "cold",
    nodeCount: raw.node_count ?? 0,
    meshVramGb: raw.mesh_vram_gb ?? 0,
    sizeGb: raw.size_gb ?? 0,
    moe: raw.moe ?? false,
    expertCount: raw.expert_count ?? null,
    usedExpertCount: raw.used_expert_count ?? null,
    activeNodes: raw.active_nodes ?? [],
    splitKind: normalizeSplitKind(raw.split_kind),
    meshFit: normalizeMeshFit(raw.mesh_fit),
  };
}

export type MeshModelsState = {
  online: boolean;
  loading: boolean;
  models: MeshModel[];
};

const POLL_MS = 8000;

/**
 * Live subscription to the runtime's mesh-model inventory, including the
 * Phase A topology fields (`split_kind`, `mesh_fit`). Polls `/api/mesh-models`
 * which is itself a thin proxy to the runtime's `/api/models`.
 *
 * Returns an empty list while the runtime is unreachable so callers don't
 * have to special-case the loading state — the `loading` flag distinguishes
 * "first probe still in flight" from "really empty".
 */
export function useMeshModels(): MeshModelsState {
  const [state, setState] = useState<MeshModelsState>({
    online: false,
    loading: true,
    models: [],
  });

  useEffect(() => {
    let cancelled = false;
    const url = apiUrl("/api/mesh-models");
    const tick = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { mesh_models?: RuntimeMeshModel[] };
        if (!cancelled) {
          setState({
            online: true,
            loading: false,
            models: (data.mesh_models ?? []).map(normalizeMeshModel),
          });
        }
      } catch {
        if (!cancelled) {
          setState({
            online: false,
            loading: false,
            models: [],
          });
        }
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return state;
}
