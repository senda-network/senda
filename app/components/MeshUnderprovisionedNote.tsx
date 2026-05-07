"use client";

import Link from "next/link";
import { loadedModelUnderprovisioning } from "../lib/mesh-fit";
import { useMeshModels } from "../lib/use-mesh-models";

/**
 * Warning banner shown above the chat composer when the only loaded
 * model on the mesh is in the cold/mmap-fallback state — i.e.
 * llama-server has accepted it but the host is too small to actually
 * serve it. Without this, the chat surface gives no hint that every
 * Send is going to hang or time out, and the only signal the user gets
 * is the friendlyChatError "temporarily unavailable" line *after* a
 * 300-second timeout.
 *
 * Renders null when:
 *   - the runtime hasn't surfaced any models yet
 *   - at least one warm/servable model is available (chat will work)
 *   - the underprovisioning shortfall is below the threshold (transient
 *     post-load, see app/lib/mesh-fit.ts for the rationale)
 */
export function MeshUnderprovisionedNote() {
  const { models, loading, online } = useMeshModels();
  if (loading || !online) return null;

  // If at least one warm model is genuinely servable (not cold), chat
  // will route there and we don't need to alarm the user. Only when
  // *every* available model is in the underprovisioned state does this
  // banner fire — that's the case where every Send genuinely will hang.
  const servable = models.filter(
    (m) => m.status === "warm" && m.splitKind !== "cold",
  );
  if (servable.length > 0) return null;

  const underprovisioned = models
    .filter((m) => m.status === "warm")
    .map((m) => ({ model: m, under: loadedModelUnderprovisioning(m) }))
    .find((x) => x.under !== null);
  if (!underprovisioned || !underprovisioned.under) return null;

  const { model, under } = underprovisioned;
  const name = model.displayName || model.name;

  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-[12px] text-amber-200">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-amber-200">
            {name} is loaded but underprovisioned.
          </div>
          <div className="mt-1 text-amber-300/85">
            The runtime accepted it via mmap fallback, but the host doesn&apos;t
            have enough memory to serve it on its own (needs ~
            {under.needGb.toFixed(0)} GB, mesh has ~{under.haveGb.toFixed(0)} GB).
            Chat requests will hang or time out until a peer with at least{" "}
            {under.shortfallGb.toFixed(0)} GB more memory joins.
          </div>
        </div>
        <Link
          href="/nodes"
          className="shrink-0 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/20"
        >
          Add a peer →
        </Link>
      </div>
    </div>
  );
}
