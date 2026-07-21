/**
 * Chat-viable = ready supply, not merely dialable inventory.
 *
 * `selectable` (see selectable-mesh-models.ts) answers: can the entry reach
 * a host that claims this model? Chat-viable asks: is at least one of those
 * hosts actually serving it with enough memory to solo?
 *
 * LYU loading Gemma on 13 GB must not keep the model in the composer when
 * no capable serving peer exists. Elevens serving on ~24 GB does.
 */

import { MODEL_CATALOG } from "./model-catalog";
import { modelIdsMatch } from "./model-id";
import {
  isSelectableMeshModel,
  peerIsDialable,
  type MeshModelSelectInput,
  type PeerDialability,
} from "./selectable-mesh-models";

export type ChatViablePeer = PeerDialability & {
  state?: string | null;
  serving_models?: string[] | null;
  hosted_models?: string[] | null;
  vram_gb?: number | null;
  capability?: {
    loaded_models?: string[] | null;
    vram_total_mb?: number | null;
    can_serve_max_gb?: number | null;
  } | null;
};

export type ChatViableModelInput = MeshModelSelectInput & {
  size_gb?: number | null;
  mesh_fit?: {
    needed_vram_gb?: number | null;
    fits_on_largest_node?: boolean | null;
  } | null;
};

function peerListsModel(peer: ChatViablePeer, modelId: string): boolean {
  const ids = [
    ...(peer.serving_models ?? []),
    ...(peer.hosted_models ?? []),
    ...(peer.capability?.loaded_models ?? []),
  ];
  return ids.some((id) => typeof id === "string" && modelIdsMatch(id, modelId));
}

function peerIsServing(peer: ChatViablePeer): boolean {
  // Missing state = older runtime; treat as serving (same as SLA gate).
  if (peer.state == null || peer.state === "") return true;
  return peer.state === "serving";
}

/** Usable VRAM for fit checks; 0 means "unknown / unreported". */
export function peerUsableVramGb(peer: ChatViablePeer): number {
  const canServe = peer.capability?.can_serve_max_gb;
  if (typeof canServe === "number" && canServe > 0) return canServe;
  if (typeof peer.vram_gb === "number" && peer.vram_gb > 0) return peer.vram_gb;
  const mb = peer.capability?.vram_total_mb;
  if (typeof mb === "number" && mb > 0) return mb / 1024;
  return 0;
}

/**
 * Memory the model needs to solo. Prefer runtime mesh_fit, then catalog
 * minVram, then size×1.1. 0 = unknown (do not fail the VRAM check).
 */
export function neededSoloVramGb(model: ChatViableModelInput): number {
  const fromFit = model.mesh_fit?.needed_vram_gb;
  if (typeof fromFit === "number" && fromFit > 0) return fromFit;
  const catalog = MODEL_CATALOG.find((m) => modelIdsMatch(m.id, model.name));
  if (catalog && catalog.minVramGb > 0) return catalog.minVramGb;
  if (typeof model.size_gb === "number" && model.size_gb > 0) {
    return model.size_gb * 1.1;
  }
  return 0;
}

function peerHasEnoughVram(peer: ChatViablePeer, neededGb: number): boolean {
  if (neededGb <= 0) return true;
  const have = peerUsableVramGb(peer);
  // Unknown VRAM on a serving peer: don't hide (legacy / partial payloads).
  if (have <= 0) return true;
  // Small slack for measurement noise vs catalog floors.
  return have + 0.5 >= neededGb;
}

/**
 * True when a specific peer is ready supply for this model.
 */
export function peerIsReadyHost(
  peer: ChatViablePeer,
  model: ChatViableModelInput,
  selfHostname: string | null | undefined,
): boolean {
  const host = peer.hostname ?? "";
  if (!peerIsDialable(host, [peer], selfHostname)) return false;
  if (!peerIsServing(peer)) return false;
  if (!peerListsModel(peer, model.name)) return false;
  return peerHasEnoughVram(peer, neededSoloVramGb(model));
}

/**
 * Chat composer may offer this model: dialable inventory AND at least one
 * serving, capable host.
 */
export function isChatViableMeshModel(
  model: ChatViableModelInput,
  peers: ChatViablePeer[],
  selfHostname: string | null | undefined,
): boolean {
  if (!isSelectableMeshModel(model, peers, selfHostname)) return false;
  return peers.some((p) => peerIsReadyHost(p, model, selfHostname));
}

/**
 * Admin `/api/status` lists remotes in `peers[]` but keeps the local node on
 * top-level fields. Fold self in so a desktop that is itself serving stays
 * chat-viable.
 */
export function peersWithSelf(
  peers: ChatViablePeer[],
  status: {
    my_hostname?: string | null;
    node_state?: string | null;
    serving_models?: string[] | null;
    hosted_models?: string[] | null;
    my_vram_gb?: number | null;
    capability?: ChatViablePeer["capability"];
  } | null | undefined,
): ChatViablePeer[] {
  const host = status?.my_hostname?.trim();
  if (!host) return peers;
  if (peers.some((p) => p.hostname === host)) return peers;
  return [
    ...peers,
    {
      hostname: host,
      // Self is always dialable from this admin view.
      rtt_ms: 0,
      state: status?.node_state ?? undefined,
      serving_models: status?.serving_models ?? [],
      hosted_models: status?.hosted_models ?? [],
      vram_gb: status?.my_vram_gb ?? undefined,
      capability: status?.capability ?? undefined,
    },
  ];
}

/**
 * Annotate inventory with both flags. `selectable` stays reachability;
 * `chat_viable` is what the composer filters on.
 */
export function withMeshOfferFlags<T extends ChatViableModelInput>(
  models: T[],
  peers: ChatViablePeer[],
  selfHostname: string | null | undefined,
): Array<T & { selectable: boolean; chat_viable: boolean }> {
  return models.map((m) => {
    const selectable = isSelectableMeshModel(m, peers, selfHostname);
    return {
      ...m,
      selectable,
      chat_viable: selectable && isChatViableMeshModel(m, peers, selfHostname),
    };
  });
}
