import { NextResponse } from "next/server";
import { applyCors, preflightResponse } from "../_cors";
import { listReports, type StoredPeerReport } from "../peer-report/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// See the matching helper in app/api/chat/route.ts for the rationale —
// Vercel has shipped trailing-newline env values to us before, and a raw
// `${RUNTIME_URL}/models` then carries a literal newline mid-URL. Trim
// defensively at the read site.
function trimmedEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value) return value;
  }
  return undefined;
}

const RUNTIME_URL =
  trimmedEnv("CLOSEDMESH_RUNTIME_URL", "MESH_LLM_URL") ??
  "http://127.0.0.1:9337/v1";

const ADMIN_URL =
  trimmedEnv("CLOSEDMESH_ADMIN_URL", "MESH_CONSOLE_URL") ??
  "http://127.0.0.1:3131";

const RUNTIME_TOKEN = trimmedEnv("CLOSEDMESH_RUNTIME_TOKEN") ?? "";

const runtimeHeaders: Record<string, string> = RUNTIME_TOKEN
  ? { Authorization: `Bearer ${RUNTIME_TOKEN}` }
  : {};

// Public mesh entry node. Used to enrich the local runtime's view with peers
// it isn't directly P2P-connected to. The desktop app's local closedmesh-llm
// only lists peers it has a live iroh link to (typically just the entry node
// itself), so a Mesh page that reads only the local runtime shows "1 machine"
// even when the entry sees three peers connected through it. The entry's
// `/api/status` and `/v1/models` are unauthenticated by the Caddyfile in
// front of the Lightsail container, so no bearer token is required for the
// enrichment.
//
// We skip the enrichment fetch when ADMIN_URL already points at the entry
// node (i.e. the website itself, where the local response IS the mesh-wide
// response). Override via env for staging / non-default entries.
const MESH_DISCOVERY_BASE =
  trimmedEnv("CLOSEDMESH_MESH_DISCOVERY_URL") ?? "https://mesh.closedmesh.com";

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return a === b;
  }
}

const ENRICH_FROM_ENTRY = !sameHost(MESH_DISCOVERY_BASE, ADMIN_URL);

/**
 * Hard cap on the entry-node enrichment fetches.
 *
 * Without a timeout, `Promise.all([…, fetchEntryStatus, fetchEntryModels])`
 * inside the desktop app blocks the entire `/api/status` response on a
 * round-trip to `mesh.closedmesh.com`. On a healthy connection that's
 * 100–400 ms (fine), but on a flaky/slow network the OS TCP timeout can
 * push it to multiple seconds — during which the Models page renders
 * with `mesh.nodes = []` and the fit pill stays blank. That's the
 * "warning appears after some seconds" UX issue.
 *
 * 1500 ms is generous enough that a healthy network virtually always
 * makes it, and short enough that worst-case the user just sees the
 * local-only view for one tick before the next 8 s poll picks up the
 * enrichment. Local-runtime data is still ready in a few ms either way.
 */
const ENRICH_TIMEOUT_MS = 1500;

/**
 * Race a fetch against a hard deadline. Aborts the underlying request on
 * timeout so we don't leak sockets, and resolves to a caller-supplied
 * fallback so the rest of the pipeline can keep going.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs: number },
): Promise<Response | null> {
  const { timeoutMs, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Per-node capability summary surfaced in the chat UI. */
export type NodeCapabilitySummary = {
  /** "metal" | "cuda" | "rocm" | "vulkan" | "cpu" */
  backend: string;
  /** "apple" | "nvidia" | "amd" | "intel" | "none" */
  vendor: string;
  /** "lo" | "mid" | "hi" | "pro" */
  computeClass: string;
  /**
   * Memory this peer can actually contribute to a serve right now. Already
   * clamped to the runtime's own fit-time budget (`can_serve_max_gb`) when
   * reported, so summing this across peers gives a pooled figure the mesh
   * can actually plan against — not the inflated nameplate VRAM total.
   */
  vramGb: number;
  loadedModels: string[];
};

/**
 * Coarse classification of a node's role inside an active distributed
 * inference. Mirrors `closedmesh-llm/closedmesh/src/api/status.rs`'s
 * `PeerPayload.split_role`. The Mesh page reads this to render role badges
 * so the user understands when their box is contributing layers to a
 * collective serve vs running solo.
 *
 * `null` means "no split role to surface" — the node is standby, solo, or
 * the runtime is too old to report this field.
 */
export type SplitRole =
  | "pipeline_host"
  | "pipeline_worker"
  | "moe_shard"
  | null;

/**
 * Pipeline-parallel split group membership for a node. `null` when the node
 * is not currently in a multi-node serving group.
 */
export type SplitGroup = {
  model: string;
  hostId: string;
  peerIds: string[];
  totalGroupVramGb: number;
};

/** MoE expert-shard membership for a node. */
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
  /** See `use-mesh-status.ts` doc; matches `system_ram_bytes` from the runtime status payload. */
  systemRamBytes?: number;
  servingModels: string[];
  inflightRequests?: number;
  capability: NodeCapabilitySummary;
  /**
   * Runtime version this peer is reporting (e.g. "0.65.7"). Surfaced
   * because outdated peers are a frequent cause of "this machine isn't
   * working" — knowing the version is the difference between debugging
   * "what's broken in the runtime" vs "this peer just needs to update".
   * Null if the peer isn't reporting one (shouldn't happen on supported
   * versions, but the local-node synth path may not have it).
   */
  version: string | null;
  /**
   * How this node is currently participating in inference for one of the
   * mesh's active models. Drives the role badges on the Mesh page.
   * Always null for standby/solo nodes or when the runtime is older than
   * the schema (treat missing as "unknown, render legacy view").
   */
  splitRole: SplitRole;
  /**
   * When present, the pipeline-parallel split group this node belongs to.
   * The Mesh page draws a small topology diagram per active split using
   * this data plus per-model `MeshModel.pipelineGroup`.
   */
  splitGroup: SplitGroup | null;
  /**
   * When present, the MoE expert-shard membership for this node.
   */
  moeShard: MoeShard | null;
  /**
   * Phase 1 marketplace metrics: per-model median t/s this peer
   * actually measured over the last hour. Optional + missing-friendly:
   * peers on runtimes older than v0.66.42 won't include these, and
   * the Catalog view treats absent / empty maps as "no measurements
   * yet, render placeholder row" rather than "measured zero".
   */
  measuredTpsP50ByModel?: Record<string, number>;
  measuredTtftMsP50ByModel?: Record<string, number>;
  /**
   * Phase 3.0 benchmark honesty (runtime v0.66.49+): per-model native
   * llama-server TPS/TTFT measured by issuing a synthetic chat directly
   * to 127.0.0.1, bypassing the entry tunnel, auth gateway, and routing
   * layer. Paired with `measuredTpsP50ByModel` lets the Catalog render
   * the through-mesh / native ratio per (peer, model). Missing keys
   * mean "no baseline yet" (legacy peer or pre-baseline window).
   */
  nativeTpsP50ByModel?: Record<string, number>;
  nativeTtftMsP50ByModel?: Record<string, number>;
  /**
   * True when this node is the elected `pipeline_host` for a model but
   * one or more peers in `splitGroup.peerIds` is not yet `state="serving"`.
   * In that case the node is structurally unable to fulfil inference for
   * the model — the workers haven't loaded their layer ranges — and the
   * route layer overrides `state` to `"loading"` and clears
   * `capability.loadedModels` so downstream consumers (the public status
   * page, the chat catalog, the SDK) don't mistake intent for capability.
   *
   * The pre-override `serving_models` list is preserved on `servingModels`
   * so the UI can still say "trying to load DeepSeek-R1-Distill-70B,
   * waiting on 2 workers". Always `false` for solo serves and standby
   * nodes; only meaningful when `splitRole === "pipeline_host"`.
   */
  pipelineDegraded: boolean;
  /**
   * Self-audit snapshot from the node's mesh-visibility loop. Mirrors
   * `closedmesh::mesh::visibility::MeshVisibilitySnapshot`. Present
   * only for the self node today (the only node we have a local
   * runtime for); a future slice will phone-home per-peer audits so
   * other nodes' visibility can be rendered the same way.
   *
   * Null on older runtimes that don't run the audit loop, or on the
   * entry node itself (no parent entry to verify against).
   */
  meshVisibility: MeshVisibility | null;
};

export type MeshVisibility = {
  state: "unknown" | "visible" | "invisible" | "entry_unreachable";
  lastCheckUnix: number | null;
  lastVisibleUnix: number | null;
  consecutiveInvisibleCount: number;
  lastError: string | null;
  entryUrl: string;
  softReconnectTriggered: boolean;
  hardResetTriggered: boolean;
};

type Status = {
  online: boolean;
  nodeCount: number;
  models: string[];
  /** Per-node capability surface — empty when the admin port is unreachable. */
  nodes: NodeSummary[];
};

type RuntimeCapability = {
  backend?: string;
  vendor?: string;
  compute_class?: string;
  vram_total_mb?: number;
  vram_free_mb?: number;
  /**
   * The runtime's own fit-time estimate of the largest single model this
   * peer can host. It bakes in llama-server overhead, KV cache headroom,
   * and driver reservations — i.e. it's the number the planner actually
   * trusts when deciding whether a model fits. The raw `vram_total_mb`
   * is an inventory figure and can over-state usable capacity by 10–30%,
   * which is exactly the gap that made the public status page claim
   * "Capacity is sufficient" while no host could be elected.
   */
  can_serve_max_gb?: number;
  loaded_models?: string[];
};

type RuntimeSplitGroup = {
  model: string;
  host_id: string;
  peer_ids: string[];
  total_group_vram_gb: number;
};

type RuntimeMoeShard = {
  model: string;
  total_shards: number;
};

type RuntimePeer = {
  id?: string;
  role?: string;
  state?: string;
  hostname?: string | null;
  vram_gb?: number;
  serving_models?: string[];
  hosted_models?: string[];
  inflight_requests?: number;
  system_ram_bytes?: number;
  capability?: RuntimeCapability;
  version?: string;
  /**
   * Phase A schema additions — older runtimes (<0.66) won't emit these.
   * Treated as optional; null/missing means "no split role to surface".
   */
  split_role?: string | null;
  split_group?: RuntimeSplitGroup | null;
  moe_shard?: RuntimeMoeShard | null;
  /**
   * Phase 1 marketplace metrics (runtime v0.66.42+). Empty / missing
   * map means "this peer hasn't reported any local-inference timings
   * for any model yet" — not "measured zero". The Catalog view on
   * `/status` uses this distinction to render a "no measurements yet"
   * fallback row for catalog models nobody on the mesh has served.
   */
  measured_tps_p50_by_model?: Record<string, number>;
  measured_ttft_ms_p50_by_model?: Record<string, number>;
  /**
   * Phase 3.0 benchmark honesty (runtime v0.66.49+). Per-model native
   * llama-server TPS/TTFT measured by issuing a synthetic chat directly
   * to 127.0.0.1 — bypassing the entry tunnel, auth gateway, and
   * routing layer. Paired with `measured_*` lets the Catalog render
   * the through-mesh / native ratio per (peer, model). Empty / missing
   * means "no baseline collected yet" (legacy peer or pre-baseline).
   */
  native_tps_p50_by_model?: Record<string, number>;
  native_ttft_ms_p50_by_model?: Record<string, number>;
};

type RuntimeGpu = {
  name?: string;
  vram_bytes?: number;
};

/**
 * Mirrors `closedmesh::mesh::visibility::MeshVisibilitySnapshot` in the
 * runtime — see the doc on the Rust struct for the full audit semantics.
 * Present only when the runtime was started with `--join-url`; absent
 * (and treated as null) on older runtimes that pre-date Slice 1.
 */
type RuntimeMeshVisibility = {
  state: "unknown" | "visible" | "invisible" | "entry_unreachable";
  last_check_unix?: number | null;
  last_visible_unix?: number | null;
  consecutive_invisible_count: number;
  last_error?: string | null;
  entry_url: string;
  soft_reconnect_triggered: boolean;
  hard_reset_triggered: boolean;
};

type RuntimeStatus = {
  node_id?: string;
  is_host?: boolean;
  is_client?: boolean;
  node_state?: string;
  my_hostname?: string | null;
  my_vram_gb?: number;
  my_is_soc?: boolean;
  serving_models?: string[];
  hosted_models?: string[];
  inflight_requests?: number;
  system_ram_bytes?: number;
  /**
   * Phase 1 marketplace metrics (runtime v0.66.42+) — same fields and
   * semantics as on `RuntimePeer`. These cover the local node; peer
   * entries carry their own gossiped versions via `peers[].measured_*`.
   */
  measured_tps_p50_by_model?: Record<string, number>;
  measured_ttft_ms_p50_by_model?: Record<string, number>;
  /** Phase 3.0 benchmark honesty (runtime v0.66.49+) — see `RuntimePeer`. */
  native_tps_p50_by_model?: Record<string, number>;
  native_ttft_ms_p50_by_model?: Record<string, number>;
  capability?: RuntimeCapability;
  /** rc2 and earlier emit GPU info here rather than inside `capability`. */
  gpus?: RuntimeGpu[];
  peers?: RuntimePeer[];
  /** Runtime version of THIS node (the one serving the /api/status). */
  version?: string;
  /**
   * Phase A self-fields — present on >=0.66 runtimes only. Used by the
   * dashboard's "you're holding layers X-Y of model Z" card.
   */
  my_split_role?: string | null;
  my_split_group?: RuntimeSplitGroup | null;
  my_moe_shard?: RuntimeMoeShard | null;
  /**
   * Mesh-visibility audit snapshot for THIS node. Only the local
   * runtime emits this on its own /api/status — peers do not include
   * it in gossip — so it's surfaced only on the self node in
   * `NodeSummary.meshVisibility`. Older runtimes simply omit the
   * field, in which case `normalizeMeshVisibility` returns null and
   * the UI degrades to its pre-Slice-1 behaviour.
   */
  mesh_visibility?: RuntimeMeshVisibility | null;
};

function normalizeSplitRole(raw: string | null | undefined): SplitRole {
  if (raw === "pipeline_host" || raw === "pipeline_worker" || raw === "moe_shard") {
    return raw;
  }
  return null;
}

function normalizeSplitGroup(
  raw: RuntimeSplitGroup | null | undefined,
): SplitGroup | null {
  if (!raw) return null;
  return {
    model: raw.model,
    hostId: raw.host_id,
    peerIds: raw.peer_ids ?? [],
    totalGroupVramGb: raw.total_group_vram_gb ?? 0,
  };
}

function normalizeMoeShard(
  raw: RuntimeMoeShard | null | undefined,
): MoeShard | null {
  if (!raw) return null;
  return {
    model: raw.model,
    totalShards: raw.total_shards ?? 0,
  };
}

export function normalizeMeshVisibility(
  raw: RuntimeMeshVisibility | null | undefined,
): MeshVisibility | null {
  if (!raw) return null;
  // Defensive: accept any string here but only declare the four known
  // states in our type. Future runtime values pass through as "unknown"
  // so the UI doesn't crash on a schema bump.
  const state: MeshVisibility["state"] =
    raw.state === "visible" ||
    raw.state === "invisible" ||
    raw.state === "entry_unreachable" ||
    raw.state === "unknown"
      ? raw.state
      : "unknown";
  return {
    state,
    lastCheckUnix: raw.last_check_unix ?? null,
    lastVisibleUnix: raw.last_visible_unix ?? null,
    consecutiveInvisibleCount: raw.consecutive_invisible_count ?? 0,
    lastError: raw.last_error ?? null,
    entryUrl: raw.entry_url ?? "",
    softReconnectTriggered: !!raw.soft_reconnect_triggered,
    hardResetTriggered: !!raw.hard_reset_triggered,
  };
}

/**
 * `hostedOverride` is the peer's top-level `hosted_models` list. We accept it
 * as an override because the runtime's `capability.loaded_models` is observably
 * unreliable for pipeline_host peers — it stays empty even after the host's
 * `hosted_models` has flipped on (which is the runtime's `llama_ready` gate).
 * That mismatch made the public status page render Mac as "Loading" while it
 * was genuinely serving Qwen3-30B as a pipeline host. The local self-node
 * path already treats `hosted_models` as authoritative (see
 * `inferLocalCapability`); peers should be treated the same way.
 */
function summarizeCapability(
  cap: RuntimeCapability | undefined,
  hostedOverride?: string[] | null,
  usableVramGb?: number,
): NodeCapabilitySummary {
  const advertisedVramGb = Math.round(((cap?.vram_total_mb ?? 0) / 1024) * 10) / 10;
  const usableHintGb =
    typeof usableVramGb === "number" && usableVramGb > 0
      ? Math.round(usableVramGb * 10) / 10
      : 0;
  // `can_serve_max_gb` is the runtime's own fit-time budget: nameplate
  // VRAM minus llama-server overhead, KV cache headroom, and driver
  // reservations. It's the number the planner trusts when deciding
  // whether a model fits, so it's the truthful clamp for what each peer
  // can contribute to a pooled serve. Without it, we fall through to
  // the two inventory numbers (capability.vram_total and the peer's
  // top-level vram_gb), which both over-state usable memory.
  const canServeMaxGb =
    typeof cap?.can_serve_max_gb === "number" && cap.can_serve_max_gb > 0
      ? cap.can_serve_max_gb
      : 0;
  // Pick the smallest non-zero value across the three numbers we have.
  // Anything that's zero is treated as "unreported" rather than "this
  // peer contributes zero" — a single missing field shouldn't zero out
  // the pool. When ALL three are zero we honestly report zero.
  const candidates = [advertisedVramGb, usableHintGb, canServeMaxGb].filter(
    (v) => v > 0,
  );
  const vramGb = candidates.length > 0 ? Math.min(...candidates) : 0;
  return {
    backend: cap?.backend ?? "unknown",
    vendor: cap?.vendor ?? "none",
    computeClass: cap?.compute_class ?? "lo",
    vramGb,
    loadedModels: hostedOverride ?? cap?.loaded_models ?? [],
  };
}

/**
 * rc2 and earlier don't emit a top-level `capability` object for the local
 * node — that field is only populated on peer entries. Instead the runtime
 * exposes `gpus[]`, `my_vram_gb`, and `my_is_soc`. Synthesize a
 * RuntimeCapability from those fields so the rest of the pipeline sees
 * consistent data regardless of which runtime version is running locally.
 */
function inferLocalCapability(rt: RuntimeStatus): RuntimeCapability {
  if (rt.capability) return rt.capability;

  const gpuName = (rt.gpus?.[0]?.name ?? "").toLowerCase();
  const isSoc = rt.my_is_soc ?? false;

  let backend = "cpu";
  let vendor = "none";
  let computeClass = "lo";

  if (isSoc || gpuName.includes("apple") || gpuName.includes("m1") || gpuName.includes("m2") || gpuName.includes("m3") || gpuName.includes("m4")) {
    backend = "metal";
    vendor = "apple";
    computeClass = "hi";
  } else if (gpuName.includes("nvidia") || gpuName.includes("geforce") || gpuName.includes("rtx") || gpuName.includes("gtx") || gpuName.includes("tesla") || gpuName.includes("a100") || gpuName.includes("h100")) {
    backend = "cuda";
    vendor = "nvidia";
    computeClass = "hi";
  } else if (gpuName.includes("amd") || gpuName.includes("radeon") || gpuName.includes("rx ")) {
    backend = "rocm";
    vendor = "amd";
    computeClass = "mid";
  } else if (gpuName.includes("intel") || gpuName.includes("arc")) {
    backend = "vulkan";
    vendor = "intel";
    computeClass = "mid";
  }

  // my_vram_gb is already in GB — convert to MB for summarizeCapability.
  const vram_total_mb = Math.round((rt.my_vram_gb ?? 0) * 1024);

  // Treat ONLY `hosted_models` as actually loaded. The runtime sets
  // `serving_models` the moment it commits to bringing a model up — well
  // before llama-server has finished loading the GGUF — so unioning the
  // two makes the dashboard claim "READY · model" while the runtime is
  // still in `node_state: "loading"`. `hosted_models` only flips on once
  // `llama_ready === true`, which is the invariant the UI cares about.
  const loaded_models = rt.hosted_models ?? [];

  return { backend, vendor, compute_class: computeClass, vram_total_mb, loaded_models };
}

async function fetchModels(): Promise<string[]> {
  const res = await fetch(`${RUNTIME_URL}/models`, {
    cache: "no-store",
    headers: runtimeHeaders,
  });
  if (!res.ok) throw new Error(`models ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return (data.data ?? []).map((m) => m.id);
}

/**
 * Pull the runtime's `/api/status` payload. Returns null when the admin port
 * is unreachable (e.g. headless installs that only expose :9337). The chat UI
 * gracefully degrades to a count-only status pill in that case.
 */
async function fetchRuntimeStatus(): Promise<RuntimeStatus | null> {
  try {
    const res = await fetch(`${ADMIN_URL}/api/status`, {
      cache: "no-store",
      headers: runtimeHeaders,
    });
    if (!res.ok) return null;
    return (await res.json()) as RuntimeStatus;
  } catch {
    return null;
  }
}

/**
 * Pull `/api/status` from the public mesh entry node so we can list peers the
 * local runtime isn't directly P2P-connected to. Best-effort: any failure
 * (offline, captive portal, entry down) returns null and we silently fall
 * back to the local-only view — the user still sees their own machine.
 *
 * Skipped entirely when ADMIN_URL already points at the entry, both to avoid
 * a redundant network round-trip on the public site and to keep the website's
 * response shape unchanged.
 */
async function fetchEntryStatus(): Promise<RuntimeStatus | null> {
  if (!ENRICH_FROM_ENTRY) return null;
  const res = await fetchWithTimeout(`${MESH_DISCOVERY_BASE}/api/status`, {
    cache: "no-store",
    timeoutMs: ENRICH_TIMEOUT_MS,
  });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as RuntimeStatus;
  } catch {
    return null;
  }
}

/**
 * Same idea for the entry's `/v1/models` — used to enrich the model list when
 * the local runtime only knows about its own model. Returns [] on any error
 * so the caller can fall through to the local-only set.
 */
async function fetchEntryModels(): Promise<string[]> {
  if (!ENRICH_FROM_ENTRY) return [];
  const res = await fetchWithTimeout(`${MESH_DISCOVERY_BASE}/v1/models`, {
    cache: "no-store",
    timeoutMs: ENRICH_TIMEOUT_MS,
  });
  if (!res || !res.ok) return [];
  try {
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id);
  } catch {
    return [];
  }
}

function isEntryNode(hostname: string | null | undefined): boolean {
  return (hostname ?? "").startsWith("ip-");
}

function peerToNode(peer: RuntimePeer): NodeSummary {
  return {
    id: peer.id ?? "",
    hostname: peer.hostname ?? null,
    isSelf: false,
    role: peer.role ?? "Worker",
    state: peer.state ?? "standby",
    vramGb: peer.vram_gb ?? 0,
    servingModels: [
      ...(peer.serving_models ?? []),
      ...(peer.hosted_models ?? []),
    ].filter((m, i, arr) => arr.indexOf(m) === i),
    inflightRequests: peer.inflight_requests ?? 0,
    systemRamBytes: peer.system_ram_bytes,
    capability: summarizeCapability(peer.capability, peer.hosted_models, peer.vram_gb),
    version: peer.version ?? null,
    splitRole: normalizeSplitRole(peer.split_role),
    splitGroup: normalizeSplitGroup(peer.split_group),
    moeShard: normalizeMoeShard(peer.moe_shard),
    // Phase 1 marketplace metrics — runtime v0.66.42+. Older peers
    // gossip an empty `model_timings` vec which becomes `undefined`
    // here; the Catalog view distinguishes that from a present-but-
    // empty map ("measured zero") and renders the row as "no
    // measurements yet" instead.
    measuredTpsP50ByModel: peer.measured_tps_p50_by_model,
    measuredTtftMsP50ByModel: peer.measured_ttft_ms_p50_by_model,
    nativeTpsP50ByModel: peer.native_tps_p50_by_model,
    nativeTtftMsP50ByModel: peer.native_ttft_ms_p50_by_model,
    // Set in the post-processing pass `applyPipelineHealthGate`. We
    // can't decide it here because we need the full peer list to know
    // whether the workers have come up.
    pipelineDegraded: false,
    // Peers don't include their own audit snapshot in the gossip-shaped
    // RuntimePeer payload — only the self-emitter does. Null here means
    // "we have no audit information about this peer", which the UI
    // distinguishes from `state: "invisible"` (definitive negative
    // answer). Slice 4's `mergePeerReports` overwrites this when a
    // peer-report exists for the same node.
    meshVisibility: null,
  };
}

/**
 * Convert a peer report into a synthetic NodeSummary for the case
 * where the report's nodeId is *not* in the entry's peer list (i.e.
 * the silently-broken state). The visible/role/state fields are
 * conservative pessimistic defaults so the UI can render the entry
 * as "claimed-but-invisible" without lying about capability.
 *
 * `loaded_models` defaults to the report's `servingModels` because
 * the report-only path is what unlocks "this peer was hosting X but
 * we can't see them" — the loaded model list is the operationally
 * useful bit there. We mark `state: "unreachable"` because that's the
 * pre-existing label the dashboard treats as "do not route here".
 */
export function reportToInvisibleNode(report: StoredPeerReport): NodeSummary {
  return {
    id: report.nodeId,
    hostname: report.hostname,
    isSelf: false,
    role: "Worker",
    state: "unreachable",
    vramGb: 0,
    servingModels: report.servingModels,
    inflightRequests: 0,
    capability: {
      backend: "unknown",
      vendor: "none",
      computeClass: "lo",
      vramGb: 0,
      loadedModels: report.servingModels,
    },
    version: report.version,
    splitRole: null,
    splitGroup: null,
    moeShard: null,
    pipelineDegraded: false,
    meshVisibility: report.meshVisibility,
  };
}

/**
 * Merge peer-report data into the unified node list.
 *
 * Two outcomes per report:
 *   1. The peer is already in the unified list (matched by short id).
 *      We overlay the report's `meshVisibility` on the existing node
 *      — the entry's view doesn't include audit data, but the report
 *      does, and the audit is the truth signal we actually want.
 *   2. The peer is NOT in the unified list. The report is the only
 *      evidence this peer exists; synthesize a `NodeSummary` with
 *      `state: "unreachable"` so the UI can render it in a "claimed
 *      but invisible" section.
 */
export function mergePeerReports(
  nodes: NodeSummary[],
  reports: StoredPeerReport[],
  selfId: string,
): NodeSummary[] {
  const shortId = (id: string) => id.slice(0, 10);
  const byShort = new Map<string, NodeSummary>();
  for (const n of nodes) byShort.set(shortId(n.id), n);

  const result: NodeSummary[] = [...nodes];
  for (const report of reports) {
    const key = shortId(report.nodeId);
    // Don't reprocess the local self — its meshVisibility was set
    // directly from the local runtime in `buildNodes`.
    if (key === shortId(selfId)) continue;

    const existing = byShort.get(key);
    if (existing) {
      existing.meshVisibility = report.meshVisibility;
      // Refresh hostname/version from the report when the entry left
      // them blank. Don't overwrite values the entry *did* provide —
      // its view is closer to ground truth for non-audit fields.
      if (!existing.hostname && report.hostname) {
        existing.hostname = report.hostname;
      }
      if (!existing.version && report.version) {
        existing.version = report.version;
      }
      continue;
    }

    result.push(reportToInvisibleNode(report));
    byShort.set(key, result[result.length - 1]);
  }
  return result;
}

/**
 * Build the unified node list shown on the Mesh page.
 *
 * - `rt`     is the local runtime's view (self + whatever peers it has a
 *            direct iroh link to).
 * - `entry`  is the public mesh entry node's view (every peer connected to
 *            the entry, which is typically the union of all member machines).
 *            Null when we couldn't reach the entry, or when ADMIN_URL is
 *            already the entry (the website case — `rt` IS the mesh-wide
 *            view there).
 *
 * The entry's peer list is the primary source of truth for who's in the
 * mesh, but it doesn't tell us which node is "self" — that's a property of
 * the local runtime. So we always seed self from `rt` and then walk both
 * peer lists, deduping by id and short-id (the entry truncates ids to the
 * first 10 hex chars in its peer entries).
 */
function buildNodes(
  rt: RuntimeStatus,
  entry: RuntimeStatus | null,
): NodeSummary[] {
  const selfId = rt.node_id ?? "local";
  // Match against the truncated form the entry uses in `peers[].id`. The
  // local /api/status returns the full id; entry peer entries return the
  // first 10 hex chars (e.g. "179f8d10f4"). Normalize so the dedupe key
  // matches across both sources.
  const shortId = (id: string) => id.slice(0, 10);
  const selfShort = shortId(selfId);

  const nodes: NodeSummary[] = [];
  const seen = new Set<string>([selfShort]);

  nodes.push({
    id: selfId,
    hostname: rt.my_hostname ?? null,
    isSelf: true,
    role: rt.is_host ? "Host" : rt.is_client ? "Client" : "Standby",
    state: rt.node_state ?? "standby",
    vramGb: rt.my_vram_gb ?? 0,
    servingModels: [
      ...(rt.serving_models ?? []),
      ...(rt.hosted_models ?? []),
    ].filter((m, i, arr) => arr.indexOf(m) === i),
    inflightRequests: rt.inflight_requests ?? 0,
    systemRamBytes: rt.system_ram_bytes,
    capability: summarizeCapability(inferLocalCapability(rt), null, rt.my_vram_gb),
    version: rt.version ?? null,
    splitRole: normalizeSplitRole(rt.my_split_role),
    splitGroup: normalizeSplitGroup(rt.my_split_group),
    moeShard: normalizeMoeShard(rt.my_moe_shard),
    // Phase 1 marketplace metrics — see `peerToNode` for the
    // missing/empty/zero semantics.
    measuredTpsP50ByModel: rt.measured_tps_p50_by_model,
    measuredTtftMsP50ByModel: rt.measured_ttft_ms_p50_by_model,
    // Phase 3.0 benchmark honesty.
    nativeTpsP50ByModel: rt.native_tps_p50_by_model,
    nativeTtftMsP50ByModel: rt.native_ttft_ms_p50_by_model,
    pipelineDegraded: false,
    meshVisibility: normalizeMeshVisibility(rt.mesh_visibility),
  });

  const addPeers = (peers: RuntimePeer[] | undefined) => {
    for (const peer of peers ?? []) {
      // Entry nodes are always-on cloud gateways, not user machines — exclude
      // them so counts and lists only reflect real member machines.
      if (isEntryNode(peer.hostname)) continue;
      const id = peer.id ?? "";
      if (!id) continue;
      const key = shortId(id);
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push(peerToNode(peer));
    }
  };

  // Local peers first so any direct-link metadata (RTT, fresher state) wins
  // over the entry's slightly-staler view. Entry fills in the gaps.
  addPeers(rt.peers);
  addPeers(entry?.peers);

  return nodes;
}

/**
 * Mark `pipeline_host` / `pipeline_worker` nodes as `pipelineDegraded`
 * ONLY when the runtime classifier already removed them from the cohort
 * by setting `splitRole = null` upstream — that's the split-brain shape
 * (no peer in the cohort has graduated to `NodeRole::Host`) which the
 * Rust-side `classify_peer_split_role` / `classify_local_split_role`
 * `host.is_none()` arm handles since v0.66.19.
 *
 * We do NOT downgrade based on cohort members' `state` field: a healthy
 * pipeline split has the host in `state="serving"` and EVERY worker in
 * `state="loading"` (workers run only `rpc-server` and never reach
 * `serving` by design). The previous version of this gate treated those
 * `loading` workers as evidence the pipeline was degraded, blanked the
 * host's `capability.loadedModels`, and broke `scripts/ci-split-test.sh`
 * along with every legitimate split serve in production. See the CI
 * failure on commit 0fa439c8 for the trace and the matching revert in
 * `closedmesh-llm/closedmesh/src/api/mod.rs::pipeline_host_degraded`.
 *
 * This pass also drops models from the top-level `models` catalog when
 * no node is in `state="serving"` for them, so the "N models available"
 * pill matches what the chat layer can actually route — but it does so
 * by reading the runtime-supplied `state` directly, NOT by inferring
 * health from cohort membership.
 */
export function applyPipelineHealthGate(
  nodes: NodeSummary[],
  models: string[],
): { nodes: NodeSummary[]; models: string[] } {
  // The runtime already does the honest work of refusing to label a
  // peer as `pipeline_host` / `pipeline_worker` when there's no actual
  // host in the cohort (see `classify_peer_split_role` in the runtime).
  // Pre-v0.66.19 runtimes still emit those labels in the split-brain
  // case; for those we have no reliable way to distinguish "healthy
  // worker (steady-state loading)" from "deadlocked worker", so we
  // leave `pipelineDegraded = false` and trust the runtime's `state`
  // field. Newer runtimes will get the honest signal natively.
  const gatedNodes = nodes;

  // Catalog filter: a model is reachable iff at least one node has it
  // in `capability.loadedModels` AND that node is in `state="serving"`.
  // Workers in a healthy split are in `loading` and don't contribute
  // here — only the host that actually holds the routable HTTP path
  // does. That matches the runtime router's own target-picking logic.
  const reachable = new Set<string>();
  for (const n of gatedNodes) {
    if (n.state !== "serving") continue;
    for (const m of n.capability.loadedModels) reachable.add(m);
  }
  const filteredModels = models.filter((m) => reachable.has(m));
  const finalModels =
    filteredModels.length > 0
      ? filteredModels
      : models.length > 0 && reachable.size === 0
        ? []
        : filteredModels;

  return { nodes: gatedNodes, models: finalModels };
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

/**
 * Collect all models that are actually serveable across the mesh right now.
 *
 * Two sources of truth, in order:
 *   1. The entry node's `/v1/models` — this is the real, route-tested list.
 *      If a model shows up here, the entry node has at least one live peer
 *      it has elected as Host for that model and can route to.
 *   2. Fallback: peer self-reports — but ONLY counting peers that are in
 *      a usable state. A peer with `state="loading"` is NOT usable; the
 *      runtime returns "model not currently available" if you actually
 *      try to route to it. Including loading peers in this list was the
 *      bug that made the public status page say "1 model available" when
 *      every inference request 503'd, because Elevens advertised Qwen3 in
 *      its self-report while being stuck loading it.
 *
 * "Usable" means: the peer is a Host (so it owns the routing for the
 * model) AND its state is not `loading` / `unreachable` / `client`. This
 * matches how the runtime's router actually picks targets, so the public
 * "N models available" number now equals the number of models a chat
 * request would actually find a host for.
 */
function modelsFromRuntime(rt: RuntimeStatus | null, v1Models: string[]): string[] {
  if (v1Models.length > 0) return v1Models;
  if (!rt) return [];
  const seen = new Set<string>();
  const usable = (state: string | undefined) =>
    state !== "loading" &&
    state !== "unreachable" &&
    state !== "client" &&
    state !== "offline";

  if (usable(rt.node_state)) {
    for (const m of [...(rt.serving_models ?? []), ...(rt.hosted_models ?? [])]) {
      seen.add(m);
    }
  }
  for (const peer of rt.peers ?? []) {
    if (!usable(peer.state)) continue;
    // Self-reported `serving_models` is only meaningful when the peer
    // claims a Host role — Worker peers list the host's models too and
    // we'd otherwise double-count phantoms.
    const isHost = (peer.role ?? "").toLowerCase().startsWith("host");
    if (!isHost && (peer.hosted_models?.length ?? 0) === 0) continue;
    for (const m of [...(peer.serving_models ?? []), ...(peer.hosted_models ?? [])]) {
      seen.add(m);
    }
  }
  return [...seen];
}

export async function GET(req: Request) {
  try {
    // All four fetches are independent and best-effort. Entry-node fetches
    // are no-ops when ADMIN_URL is the entry (website case), so this still
    // costs the same one round-trip there.
    const [v1Models, runtime, entry, entryModels] = await Promise.all([
      fetchModels(),
      fetchRuntimeStatus(),
      fetchEntryStatus(),
      fetchEntryModels(),
    ]);
    // Prefer whichever model list is more complete — the entry node sees
    // every Host on the mesh and is the source of truth when the local
    // runtime only knows about its own loaded model.
    const localModels = modelsFromRuntime(runtime, v1Models);
    const models =
      entryModels.length > localModels.length ? entryModels : localModels;
    let nodes = runtime ? buildNodes(runtime, entry) : [];
    // Slice 4: merge in any peer audit reports the website has
    // received directly. This catches the silently-broken case — a
    // peer that claims to be serving X but isn't routable from the
    // entry — which the entry's own /api/status cannot report on by
    // construction. `listReports` returns at most a few-minute-old
    // entries; older reports are dropped on read.
    const reports = listReports();
    if (reports.length > 0) {
      const selfId = runtime?.node_id ?? "local";
      nodes = mergePeerReports(nodes, reports, selfId);
    }
    // Truth gate: a pipeline_host whose workers haven't all finished
    // loading is not actually serving anything. Apply this AFTER
    // peer-report merging so any nodes synthesised from reports (state
    // = "unreachable") factor into the worker-readiness check.
    const gated = applyPipelineHealthGate(nodes, models);
    const nodeCount = gated.nodes.length || 1;
    const status: Status = {
      online: true,
      nodeCount,
      models: gated.models,
      nodes: gated.nodes,
    };
    return applyCors(req, NextResponse.json(status));
  } catch {
    const status: Status = {
      online: false,
      nodeCount: 0,
      models: [],
      nodes: [],
    };
    return applyCors(req, NextResponse.json(status, { status: 200 }));
  }
}
