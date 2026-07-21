/**
 * Chat-selector honesty: a model may only appear in the composer picker when
 * at least one HTTP host for it is dialable from the admin/entry view.
 *
 * Runtime `status: "warm"` means "a peer claims hosted_models" — that is not
 * the same as "entry can open a QUIC tunnel to that peer". Elevens with
 * `rtt_ms: null` was advertised as warm while every chat request 503'd.
 */

export type MeshModelSelectInput = {
  name: string;
  status?: string;
  node_count?: number;
  active_nodes?: string[] | null;
};

export type PeerDialability = {
  hostname?: string | null;
  rtt_ms?: number | null;
};

/**
 * True when this admin/entry node can expect to reach `hostname` for HTTP
 * proxying. Self is always dialable; remote peers need a measured RTT
 * (proof a path existed when the mesh last probed).
 */
export function peerIsDialable(
  hostname: string,
  peers: PeerDialability[],
  selfHostname: string | null | undefined,
): boolean {
  if (!hostname) return false;
  if (selfHostname && hostname === selfHostname) return true;
  const peer = peers.find((p) => p.hostname === hostname);
  if (!peer) return false;
  return typeof peer.rtt_ms === "number" && Number.isFinite(peer.rtt_ms);
}

/**
 * Whether the chat model selector may offer this mesh model.
 */
export function isSelectableMeshModel(
  model: MeshModelSelectInput,
  peers: PeerDialability[],
  selfHostname: string | null | undefined,
): boolean {
  if ((model.status ?? "cold") !== "warm") return false;
  if ((model.node_count ?? 0) <= 0) return false;
  const active = model.active_nodes ?? [];
  if (active.length === 0) return false;
  return active.some((host) => peerIsDialable(host, peers, selfHostname));
}

/**
 * Attach `selectable` without dropping cold inventory rows (models page
 * still needs those). Chat UI filters on the flag.
 */
export function withSelectableFlags<T extends MeshModelSelectInput>(
  models: T[],
  peers: PeerDialability[],
  selfHostname: string | null | undefined,
): Array<T & { selectable: boolean }> {
  return models.map((m) => ({
    ...m,
    selectable: isSelectableMeshModel(m, peers, selfHostname),
  }));
}
