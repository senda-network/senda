/** Matches `MIN_PIPELINE_ELECTION_PEER_VERSION` in senda-llm election.rs */
export const MIN_PIPELINE_ELECTION_PEER_VERSION = "0.66.20";

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when the peer runtime is new enough for pipeline host election. */
export function peerSupportsPipelineElection(
  version: string | null | undefined,
): boolean {
  const min = parseSemver(MIN_PIPELINE_ELECTION_PEER_VERSION);
  if (!min) return false;
  const peer = version ? parseSemver(version) : null;
  if (!peer) return false;
  if (peer[0] !== min[0]) return peer[0] > min[0];
  if (peer[1] !== min[1]) return peer[1] > min[1];
  return peer[2] >= min[2];
}
