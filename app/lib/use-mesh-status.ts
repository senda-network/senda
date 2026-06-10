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

/**
 * Outcome of one mesh-visibility probe against the configured entry
 * node. Mirrors `closedmesh::mesh::visibility::MeshVisibilityState` in
 * the runtime. The audit answers the only question the dashboard's
 * green pill actually cares about: **does the entry node currently
 * know we exist?**
 *
 *   - `unknown`             — first 30 s after launch, no probe has
 *                             landed yet; render "checking…"
 *   - `visible`             — the entry's `peers[]` contains us; we
 *                             are reachable from the public website
 *   - `invisible`           — the entry was reachable but our node_id
 *                             was not in its peers list; we are
 *                             silently broken
 *   - `entry_unreachable`   — could not reach the entry at all
 *                             (network blip, captive portal, entry
 *                             rebooting)
 */
export type MeshVisibilityState =
  | "unknown"
  | "visible"
  | "invisible"
  | "entry_unreachable";

/**
 * Self-audit snapshot the runtime emits on its `/api/status` when it
 * was started with `--join-url`. Present only for the local self node
 * (peers don't audit themselves over our gossip); will be populated
 * for other nodes once Slice 4 plumbs per-peer audit reports through
 * Vercel KV.
 */
export type MeshVisibility = {
  state: MeshVisibilityState;
  /** Unix seconds of the most recent probe attempt, any outcome. */
  lastCheckUnix: number | null;
  /** Unix seconds of the most recent `visible` probe. */
  lastVisibleUnix: number | null;
  /**
   * Consecutive non-`visible` probes since the last `visible`. Drives
   * the auto-heal escalation in the runtime: 3 = soft reconnect
   * (re-`node.join` with a fresh token), 8 = hard reset (process
   * exit, supervisor restart). The dashboard renders this so users
   * can see escalation in flight rather than having to wait silently.
   */
  consecutiveInvisibleCount: number;
  /** Last failure reason; null when state is `visible`. */
  lastError: string | null;
  /** Entry URL being probed (e.g. `https://mesh.closedmesh.com`). */
  entryUrl: string;
  /**
   * True if the audit loop has issued at least one soft reconnect
   * since the last `visible` outcome. The dashboard shows this so
   * users understand the spinner means "trying to fix itself" rather
   * than "hung".
   */
  softReconnectTriggered: boolean;
  /**
   * True if the audit loop decided a hard reset is needed. Set ~1 s
   * before `std::process::exit`, so a fast UI poll can record it.
   * Once the runtime restarts the counter resets and this flips back
   * to false at the next `visible`.
   */
  hardResetTriggered: boolean;
};

export type NodeSummary = {
  id: string;
  hostname: string | null;
  isSelf: boolean;
  role: string;
  state: string;
  vramGb: number;
  /**
   * Total system RAM advertised by this peer (bytes). 0 means the peer is
   * on a pre-v0.66.38 runtime that didn't gossip this field; UI should
   * render that as "—" rather than "0 GB" to avoid implying the peer is
   * actively reporting zero RAM.
   */
  systemRamBytes?: number;
  servingModels: string[];
  inflightRequests?: number;
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
  /**
   * True when this node was elected `pipeline_host` for a model but at
   * least one peer in `splitGroup.peerIds` is not yet `state="serving"`.
   * The `/api/status` route gates this server-side: when degraded it
   * also overrides `state` to `"loading"` and clears
   * `capability.loadedModels`, so any UI that just keys off `state` and
   * `loadedModels` keeps working without changes. Surfaces tell the
   * fuller story ("Awaiting workers") by reading this flag.
   *
   * Optional in the type because older clients / cached payloads may
   * not have the field; treat `undefined` as `false`.
   */
  pipelineDegraded?: boolean;
  /**
   * Self-audit result from this node's mesh-visibility loop. Present
   * only for the self node today (the only one that runs the audit
   * loop locally). Phase 4 will populate this for other nodes by
   * fanning audit reports through the public website.
   *
   * Null on older runtimes that don't run the audit, or on the entry
   * node itself (which has nothing to audit against).
   */
  meshVisibility: MeshVisibility | null;
  /**
   * Per-model median tokens-per-second this peer has measured over the
   * last hour of successful local-inference completions. Phase 1
   * marketplace metric — runtime v0.66.42+. Missing keys mean "not yet
   * measured" rather than "measured zero"; the Catalog view on
   * `/status` keys off this map to render per-model throughput rows.
   * Object-valued and optional so older API responses (and peers on
   * runtimes that pre-date the gossip field) deserialize cleanly to
   * `undefined`.
   */
  measuredTpsP50ByModel?: Record<string, number>;
  /**
   * Per-model median time-to-first-token (milliseconds) this peer has
   * measured over the last hour of successful local-inference
   * completions. Same Phase 1 / "missing = not measured" semantics as
   * `measuredTpsP50ByModel`.
   */
  measuredTtftMsP50ByModel?: Record<string, number>;
  /**
   * Phase 3.0 benchmark honesty (runtime v0.66.49+): per-model native
   * llama-server TPS measured by the peer issuing a synthetic chat
   * directly to its own llama-server on 127.0.0.1, no mesh involved.
   * Paired with `measuredTpsP50ByModel` to render the through-mesh /
   * native ratio in the Catalog. Missing keys mean "no baseline yet".
   */
  nativeTpsP50ByModel?: Record<string, number>;
  /**
   * Per-model native time-to-first-token (ms). Same Phase 3.0 semantics
   * as `nativeTpsP50ByModel`.
   */
  nativeTtftMsP50ByModel?: Record<string, number>;
  /**
   * Per-model completion tokens THIS machine served over a rolling 7-day
   * window (runtime v0.66.72+). Local-only and disk-persisted in the
   * runtime — never gossiped — so it's populated only on the self node and
   * always absent on peers. Backs the dashboard's earnings preview.
   * Missing/empty = "served nothing this week", not "served zero".
   */
  servingTokens7dByModel?: Record<string, number>;
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
