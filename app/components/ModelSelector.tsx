"use client";

import { useEffect, useMemo } from "react";
import { useMeshModels } from "../lib/use-mesh-models";
import type { MeshModel, SplitKind } from "../lib/use-mesh-status";

const STORAGE_KEY = "closedmesh:selectedModel";

/**
 * Strip quant suffix and `.gguf` from a runtime model id so the dropdown
 * reads "Qwen3-30B-A3B" instead of "Qwen3-30B-A3B-Q4_K_M.gguf". Keeps
 * exact id around in `<option value>` so the chat request still pins to
 * the precise quant the host is serving.
 */
function pretty(id: string): string {
  return id
    .replace(/\.gguf$/i, "")
    .replace(/-Q\d+(_K(_[SM])?|_0|_1)?$/i, "")
    .replace(/-UD-Q\d+(_K(_[SM]|_XL))?$/i, "")
    .replace(/-instruct$/i, " (Instruct)");
}

/**
 * One-liner of where this model is being served right now. Drives the
 * caption under the dropdown so the visitor knows whether their request
 * will land on a single host (solo), a pooled split (pipeline / multi
 * host), or stall in the elect-then-load path (cold / no host yet).
 */
function topologyHint(model: MeshModel | undefined): string {
  if (!model) return "";
  const nodes = model.nodeCount;
  const kind: SplitKind = model.splitKind;
  if (nodes === 0 || kind === "cold") {
    return "cold · awaiting a host";
  }
  if (kind === "pipeline") {
    return `split (pipeline) · ${nodes} ${nodes === 1 ? "node" : "nodes"}`;
  }
  if (kind === "moe") {
    return `split (moe) · ${nodes} ${nodes === 1 ? "node" : "nodes"}`;
  }
  if (kind === "multi_host") {
    return `multi-host · ${nodes} nodes`;
  }
  return `solo · ${nodes} ${nodes === 1 ? "node" : "nodes"}`;
}

/**
 * Pick a sensible default when the visitor hasn't explicitly chosen yet
 * (or their previous choice has dropped out of the inventory). We prefer
 * the first warm model with at least one active node — that's the route
 * most likely to actually serve a request without waiting for an
 * election. Falls through to the first model overall, which lets the
 * dropdown render something even when nothing is hot yet (cold models
 * just take longer for the first token).
 */
function pickDefault(models: MeshModel[]): string | undefined {
  const warm = models.find(
    (m) => m.status === "warm" && m.nodeCount > 0,
  );
  if (warm) return warm.name;
  if (models.length > 0) return models[0].name;
  return undefined;
}

export type ModelSelectorProps = {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
};

/**
 * Compact model picker rendered above the chat composer. The chat API
 * (`app/api/chat/route.ts`) already accepts `body.model`; this component
 * is the UI surface that lets the visitor target a specific peer/split
 * by name instead of relying on `pickDefaultModel()`'s "first id from
 * /v1/models" heuristic — which was non-deterministic across mesh
 * changes and routed requests to whichever peer happened to be listed
 * first (e.g. a contributor's small model, even when bigger ones are
 * available).
 */
export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const { online, loading, models } = useMeshModels();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (value !== undefined) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      onChange(stored);
    }
  }, [value, onChange]);

  useEffect(() => {
    if (loading || models.length === 0) return;
    if (value && models.some((m) => m.name === value)) return;
    const next = pickDefault(models);
    if (next && next !== value) onChange(next);
  }, [loading, models, value, onChange]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!value) return;
    window.localStorage.setItem(STORAGE_KEY, value);
  }, [value]);

  const selected = useMemo(
    () => models.find((m) => m.name === value),
    [models, value],
  );

  const hint = useMemo(() => {
    if (!online && !loading) return "mesh offline · request will fail";
    if (loading && !selected) return "loading mesh inventory…";
    if (models.length === 0) return "no models advertised yet";
    return topologyHint(selected);
  }, [online, loading, models.length, selected]);

  return (
    <div className="flex items-center gap-2 text-[11px] text-[var(--fg-muted)]">
      <label className="flex items-center gap-2">
        <span className="uppercase tracking-wider">Model</span>
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          disabled={models.length === 0}
          className="max-w-[60vw] truncate rounded-md border border-[var(--border)] bg-[var(--bg-elev-2)] px-2 py-1 text-xs text-[var(--fg)] focus:border-[var(--accent)]/60 focus:outline-none disabled:opacity-50"
        >
          {models.length === 0 ? (
            <option value="">auto</option>
          ) : (
            models.map((m) => (
              <option key={m.name} value={m.name}>
                {pretty(m.displayName || m.name)}
              </option>
            ))
          )}
        </select>
      </label>
      {hint && <span className="truncate">· {hint}</span>}
    </div>
  );
}
