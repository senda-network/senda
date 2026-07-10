"use client";

import Link from "next/link";
import { loadedModelUnderprovisioning } from "../lib/mesh-fit";
import { useMeshModels } from "../lib/use-mesh-models";
import { isPublicDeployment } from "../lib/runtime-target";
import { Callout } from "./ui/Callout";

/**
 * Shown above the chat when the only loaded model is under-provisioned (the
 * host is too small to actually serve it, so every Send would hang). This one
 * stays — it's genuinely actionable — but is now a calm Callout instead of a
 * loud amber banner. On the public site the "Add a peer" affordance points at
 * the same idea via the download page; in the app it links to Mesh.
 *
 * Renders null when there's a servable model, or the shortfall is transient.
 */
export function MeshUnderprovisionedNote() {
  const { models, loading, online } = useMeshModels();
  if (loading || !online) return null;

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
  const href = isPublicDeployment() ? "/download" : "/nodes";

  return (
    <Callout
      tone="warn"
      title={`${name} is awaiting capacity`}
      action={
        <Link
          href={href}
          className="whitespace-nowrap text-[12px] font-semibold text-[var(--warn)] hover:underline"
        >
          Add a machine →
        </Link>
      }
    >
      Needs about {under.needGb.toFixed(0)} GB of pooled memory; the mesh
      currently offers {under.haveGb.toFixed(0)} GB. Connect another machine to
      bring it online.
    </Callout>
  );
}
