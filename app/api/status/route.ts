import { NextResponse } from "next/server";
import { applyCors, preflightResponse } from "../_cors";

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

/** Per-node capability summary surfaced in the chat UI. */
export type NodeCapabilitySummary = {
  /** "metal" | "cuda" | "rocm" | "vulkan" | "cpu" */
  backend: string;
  /** "apple" | "nvidia" | "amd" | "intel" | "none" */
  vendor: string;
  /** "lo" | "mid" | "hi" | "pro" */
  computeClass: string;
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
  servingModels: string[];
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
  capability?: RuntimeCapability;
  version?: string;
  /**
   * Phase A schema additions — older runtimes (<0.66) won't emit these.
   * Treated as optional; null/missing means "no split role to surface".
   */
  split_role?: string | null;
  split_group?: RuntimeSplitGroup | null;
  moe_shard?: RuntimeMoeShard | null;
};

type RuntimeGpu = {
  name?: string;
  vram_bytes?: number;
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

function summarizeCapability(cap: RuntimeCapability | undefined): NodeCapabilitySummary {
  return {
    backend: cap?.backend ?? "unknown",
    vendor: cap?.vendor ?? "none",
    computeClass: cap?.compute_class ?? "lo",
    vramGb: Math.round(((cap?.vram_total_mb ?? 0) / 1024) * 10) / 10,
    loadedModels: cap?.loaded_models ?? [],
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

  // Treat serving + hosted models as "loaded" for the local node.
  const loaded_models = [
    ...(rt.serving_models ?? []),
    ...(rt.hosted_models ?? []),
  ].filter((m, i, a) => a.indexOf(m) === i);

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
  try {
    const res = await fetch(`${MESH_DISCOVERY_BASE}/api/status`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
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
  try {
    const res = await fetch(`${MESH_DISCOVERY_BASE}/v1/models`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
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
    capability: summarizeCapability(peer.capability),
    version: peer.version ?? null,
    splitRole: normalizeSplitRole(peer.split_role),
    splitGroup: normalizeSplitGroup(peer.split_group),
    moeShard: normalizeMoeShard(peer.moe_shard),
  };
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
    capability: summarizeCapability(inferLocalCapability(rt)),
    version: rt.version ?? null,
    splitRole: normalizeSplitRole(rt.my_split_role),
    splitGroup: normalizeSplitGroup(rt.my_split_group),
    moeShard: normalizeMoeShard(rt.my_moe_shard),
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
    const nodes = runtime ? buildNodes(runtime, entry) : [];
    const nodeCount = nodes.length || 1;
    const status: Status = { online: true, nodeCount, models, nodes };
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
