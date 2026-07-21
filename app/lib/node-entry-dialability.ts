/**
 * Whether a peer looks like it is hosting a model but the mesh entry
 * cannot dial it for HTTP proxying (`rttMs === null`).
 *
 * Distinct from mesh-visibility "invisible" (peer phones home but entry
 * gossip doesn't list it): here the entry *sees* the peer and explicitly
 * reports no RTT path.
 */

import type { NodeSummary } from "./use-mesh-status";

export function nodeLooksServingButUndialable(node: NodeSummary): boolean {
  if (node.isSelf) return false;
  if ((node.hostname ?? "").startsWith("ip-")) return false;
  // Undefined = payload predates the field; only act on explicit null.
  if (node.rttMs !== null) return false;
  if (node.splitRole === "pipeline_worker") return false;
  if (node.state === "unreachable" || node.state === "offline") return false;

  const hasLoadedModel = (node.capability?.loadedModels?.length ?? 0) > 0;
  const intendsToServe = node.servingModels.length > 0;
  if (!hasLoadedModel && !intendsToServe) return false;
  if (node.state === "loading" && !hasLoadedModel) return false;

  return true;
}
