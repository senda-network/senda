"use client";

import { useEffect, useState } from "react";
import { apiUrl, isPublicDeployment } from "./runtime-target";

export type NodeCapabilitySummary = {
  backend: string;
  vendor: string;
  computeClass: string;
  vramGb: number;
  loadedModels: string[];
};

/**
 * Coarse classification of a node's role inside an active distributed
 * inference. `null` when the node is standby, solo, or the runtime is
 * older than the schema (treat missing as "unknown, render legacy view").
 */
export type SplitRole =
  | "pipeline_host"
  | "pipeline_worker"
  | "moe_shard"
  | null;

export type SplitGroup = {
  model: string;
  hostId: string;
  peerIds: string[];
  totalGroupVramGb: number;
};

export type MoeShard = {
  model: string;
  totalShards: number;
};

export type NodeSummary = {
  id: string;
  hostname: string | null;
  isSelf: boolean;
  role: string;
  state: string;
  vramGb: number;
  servingModels: string[];
  capability: NodeCapabilitySummary;
  /**
   * Runtime version this peer is reporting (e.g. "0.65.7"). Surfaced on
   * status surfaces so we can immediately tell whether a misbehaving
   * peer just needs to update vs is hitting an actual runtime bug. Null
   * if the peer hasn't reported one (older runtimes, or local-node synth
   * paths without the field).
   */
  version: string | null;
  splitRole: SplitRole;
  splitGroup: SplitGroup | null;
  moeShard: MoeShard | null;
};

/**
 * Per-model topology classification mirroring
 * `closedmesh-llm/closedmesh/src/api/status.rs::MeshModelPayload.split_kind`.
 *
 *   - `cold`        — no live host yet (model in catalog only)
 *   - `solo`        — single peer hosts/serves it
 *   - `pipeline`    — multiple peers running pipeline-parallel because the
 *                     model is too big for any one peer
 *   - `moe`         — multiple peers each running an independent MoE shard
 *   - `multi_host`  — multiple peers serving redundant copies (no split)
 */
export type SplitKind =
  | "cold"
  | "solo"
  | "pipeline"
  | "moe"
  | "multi_host";

/**
 * Mesh-wide capacity assessment for a single model. Drives the three-state
 * fit display on the Models page (solo / pooled / needs more contributors).
 */
export type MeshFit = {
  fitsOnLargestNode: boolean;
  fitsPooled: boolean;
  pooledVramGb: number;
  neededVramGb: number;
  eligiblePeerCount: number;
};

/**
 * Single mesh model the runtime knows about. Mirrors `MeshModelPayload` from
 * the runtime's `/api/models` (renamed to `mesh-models` in the proxy). Only
 * the fields the chat product actually uses are typed — leave additional
 * runtime fields unmodeled to avoid coupling.
 */
export type MeshModel = {
  name: string;
  displayName: string;
  status: "warm" | "cold" | string;
  nodeCount: number;
  meshVramGb: number;
  sizeGb: number;
  moe: boolean;
  expertCount: number | null;
  usedExpertCount: number | null;
  activeNodes: string[];
  splitKind: SplitKind;
  meshFit: MeshFit;
};

export type MeshStatus = {
  online: boolean;
  nodeCount: number;
  models: string[];
  /** Per-node capability surface. Empty when admin port is unreachable. */
  nodes: NodeSummary[];
  // True before the first probe completes — lets the UI avoid flashing the
  // "no local mesh" state on initial render of the public site.
  loading: boolean;
};

const POLL_MS = 8000;

export function useMeshStatus(): MeshStatus {
  const [status, setStatus] = useState<MeshStatus>({
    online: false,
    nodeCount: 0,
    models: [],
    nodes: [],
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const url = apiUrl("/api/status");
    const tick = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Omit<MeshStatus, "loading">;
        if (!cancelled)
          setStatus({
            online: data.online,
            nodeCount: data.nodeCount,
            models: data.models,
            nodes: data.nodes ?? [],
            loading: false,
          });
      } catch {
        if (!cancelled)
          setStatus({
            online: false,
            nodeCount: 0,
            models: [],
            nodes: [],
            loading: false,
          });
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}

export { isPublicDeployment };
