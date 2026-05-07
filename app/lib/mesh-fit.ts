/**
 * Helpers for asking "is this loaded model actually servable, or is the
 * runtime just lying because llama_ready flipped on top of an mmap-fallback
 * thrash-fest?"
 *
 * Background: llama-server reports `llama_ready = true` the moment it has
 * mmap'd the GGUF and is willing to accept requests. On Apple Silicon
 * Metal this happens even when the model is 2-3x the available VRAM
 * budget — the kernel just pages weights from disk on demand. Inference
 * is then 10-100x slower than the model's nominal speed and most chat
 * requests time out before producing any tokens. From the user's POV the
 * app says "Ready · serving" while every prompt fails.
 *
 * The runtime planner already knows about this case: it classifies the
 * model as `splitKind === "cold"` rather than `"solo"` when the loaded
 * model exceeds the host's wired-memory budget by more than a small
 * margin. We use that flag plus the per-model fit numbers to decide
 * whether to show the cheerful "Ready" or a loud "Underprovisioned —
 * add a peer" warning.
 *
 * Centralized here so the dashboard cards, the mesh-models row, the
 * status page, and any future surfaces stay in sync about the same
 * binary question. If we ever add a richer signal from the runtime
 * (e.g. an explicit `mmap_fallback: true`) this is the one place to
 * flip the source of truth.
 */

import type { MeshModel } from "./use-mesh-status";

/**
 * Smallest mesh shortfall (GB) we'll flag as "underprovisioned". A
 * sub-gigabyte miss can be a transient measurement quirk between the
 * planner and the page-cache snapshot; calling that "broken" would
 * cry-wolf on borderline-but-fine setups. Anything larger means the
 * mesh literally cannot fit the model and we should say so.
 */
const UNDERPROVISION_SHORTFALL_GB = 0.5;

export type Underprovisioning = {
  /** Pooled VRAM available across eligible peers, GB. */
  haveGb: number;
  /** What the planner thinks the model needs to actually serve, GB. */
  needGb: number;
  /** `needGb - haveGb`, never negative. */
  shortfallGb: number;
};

/**
 * Returns the shortfall (GB) when a *loaded* model is in the cold /
 * mmap-fallback state on an under-spec host, or `null` when the model
 * either isn't in that state or the shortfall is too small to flag.
 *
 * Callers must only invoke this for models the runtime currently
 * reports as loaded (i.e. present in `hosted_models`). For not-yet-
 * loaded models the planner uses different signals (`fitsOnLargestNode`
 * / `fitsPooled`) and `LiveLaunchState`'s WaitingForCapacity branch
 * already handles those.
 */
export function loadedModelUnderprovisioning(
  model: MeshModel | null,
): Underprovisioning | null {
  if (!model) return null;
  if (model.splitKind !== "cold") return null;
  const fit = model.meshFit;
  const shortfall = fit.neededVramGb - fit.pooledVramGb;
  if (shortfall <= UNDERPROVISION_SHORTFALL_GB) return null;
  return {
    haveGb: fit.pooledVramGb,
    needGb: fit.neededVramGb,
    shortfallGb: shortfall,
  };
}

/**
 * `true` iff any of the given mesh-model snapshots is loaded but
 * underprovisioned. Convenience wrapper for surfaces that just need a
 * boolean to flip the dot color or swap a copy block.
 */
export function anyLoadedUnderprovisioned(
  models: ReadonlyArray<MeshModel | null>,
): boolean {
  return models.some((m) => loadedModelUnderprovisioning(m) !== null);
}
