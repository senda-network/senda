"use client";

import { useEffect } from "react";
import { useMeshModels } from "../lib/use-mesh-models";
import type { MeshModel } from "../lib/use-mesh-status";
import { DEFAULT_DAILY_DRIVER_MODEL, getModelTier } from "../lib/model-tiers";

const STORAGE_KEY = "closedmesh:selectedModel";

/**
 * Strip quant suffix and `.gguf` from a runtime model id so the dropdown
 * reads "Qwen3-30B-A3B" instead of "Qwen3-30B-A3B-Q4_K_M.gguf". Keeps
 * the exact id in `<option value>` so the chat request still pins to
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
 * Pick a sensible default when the visitor hasn't explicitly chosen yet
 * (or their previous choice has dropped out of the inventory).
 *
 * Phase 4.A invariant — the default is *always* a daily-driver. We never
 * auto-select a capacity-tier model (e.g. DeepSeek-70B, ~1 tok/s
 * through-mesh): a brand-new visitor hitting "Hi there" on a 70B is the
 * exact UX failure the routable-network reframe is built to avoid.
 *
 * Order: a warm daily-driver (prefer the canonical flagship), else any
 * daily-driver in inventory, else `undefined` — which surfaces "auto" in
 * the dropdown and lets the server default produce an honest "no peer is
 * serving this model" error. A visitor who wants a capacity model picks
 * it explicitly from the list (where the capacity tier copy is visible).
 */
function pickDefault(models: MeshModel[]): string | undefined {
  if (models.length === 0) return undefined;
  const isDaily = (m: MeshModel) => getModelTier(m.name) === "daily_driver";
  const preferCanonical = (names: string[]): string | undefined => {
    if (names.length === 0) return undefined;
    return names.includes(DEFAULT_DAILY_DRIVER_MODEL)
      ? DEFAULT_DAILY_DRIVER_MODEL
      : names[0];
  };
  const warmDaily = preferCanonical(
    models
      .filter((m) => isDaily(m) && m.status === "warm" && m.nodeCount > 0)
      .map((m) => m.name),
  );
  if (warmDaily) return warmDaily;
  return preferCanonical(models.filter(isDaily).map((m) => m.name));
}

export type ModelSelectorProps = {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
};

/**
 * Bare `<select>` rendered inside the chat composer next to the Send
 * button. The chat API (`app/api/chat/route.ts`) already accepts
 * `body.model`; this is the UI surface that lets the visitor target a
 * specific peer/split by name instead of relying on
 * `pickDefaultModel()`'s "first id from /v1/models" heuristic — which
 * was non-deterministic across mesh changes and routed requests to
 * whichever peer happened to be listed first.
 */
export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const { loading, models } = useMeshModels();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (value !== undefined) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) onChange(stored);
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

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      disabled={models.length === 0}
      aria-label="Model"
      className="max-w-[160px] truncate rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-2 py-1.5 text-xs text-[var(--fg)] focus:border-[var(--accent)]/60 focus:outline-none disabled:opacity-50"
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
  );
}
