"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useMeshModels } from "../lib/use-mesh-models";
import type { MeshModel } from "../lib/use-mesh-status";
import { DEFAULT_DAILY_DRIVER_MODEL, getModelTier } from "../lib/model-tiers";
import { isPublicDeployment } from "../lib/runtime-target";
import { Popover } from "./ui/Popover";
import { cn } from "./ui/cn";

const STORAGE_KEY = "senda:selectedModel";

/**
 * Strip quant suffix and `.gguf` from a runtime model id so the switcher reads
 * "Qwen3-30B-A3B" instead of "Qwen3-30B-A3B-Q4_K_M.gguf". The exact id is still
 * what we pass to the chat request so it pins to the precise quant.
 */
function pretty(id: string): string {
  return id
    .replace(/\.gguf$/i, "")
    .replace(/-Q\d+(_K(_[SM])?|_0|_1)?$/i, "")
    .replace(/-UD-Q\d+(_K(_[SM]|_XL))?$/i, "")
    .replace(/-instruct$/i, " (Instruct)");
}

/** Models the chat composer is allowed to offer — never a 503-bait row. */
function selectableModels(models: MeshModel[]): MeshModel[] {
  return models.filter((m) => m.selectable === true);
}

/**
 * Pick a sensible default when nothing is chosen yet. Always a daily-driver —
 * never auto-select a slow capacity-tier model. See the original rationale
 * retained from the previous select implementation.
 */
function pickDefault(models: MeshModel[]): string | undefined {
  const options = selectableModels(models);
  if (options.length === 0) return undefined;
  const isDaily = (m: MeshModel) => getModelTier(m.name) === "daily_driver";
  const preferCanonical = (names: string[]): string | undefined => {
    if (names.length === 0) return undefined;
    return names.includes(DEFAULT_DAILY_DRIVER_MODEL)
      ? DEFAULT_DAILY_DRIVER_MODEL
      : names[0];
  };
  const warmDaily = preferCanonical(
    options.filter(isDaily).map((m) => m.name),
  );
  if (warmDaily) return warmDaily;
  return preferCanonical(options.map((m) => m.name));
}

export type ModelSelectorProps = {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
};

/**
 * Calm model switcher for the chat composer: a quiet button showing the active
 * model that opens a popover list, rather than a cramped native `<select>`.
 * Keeps the default-picking + localStorage persistence from before.
 */
export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const { loading, models } = useMeshModels();
  const options = selectableModels(models);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (value !== undefined) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // Only restore a stored id if it is still selectable — otherwise we
    // would pin the composer on a model that 503s until the next effect.
    if (stored && models.some((m) => m.name === stored && m.selectable)) {
      onChange(stored);
    }
  }, [value, onChange, models]);

  useEffect(() => {
    if (loading) return;
    const available = selectableModels(models);
    if (value && available.some((m) => m.name === value)) return;
    const next = pickDefault(models);
    if (next !== value) onChange(next);
  }, [loading, models, value, onChange]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!value) return;
    window.localStorage.setItem(STORAGE_KEY, value);
  }, [value]);

  const current = value
    ? pretty(value)
    : options.length === 0
      ? "No models"
      : "Auto";

  return (
    <Popover
      side="top"
      align="end"
      width={260}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          disabled={options.length === 0}
          aria-label="Choose model"
          className={cn(
            "flex max-w-[180px] items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elev-2)] px-2.5 py-1.5 text-[12px] text-[var(--fg-muted)] transition-colors",
            "hover:border-[var(--border-strong)] hover:text-[var(--fg)] disabled:opacity-50",
            open && "border-[var(--border-strong)] text-[var(--fg)]",
          )}
        >
          <span className="truncate">{current}</span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="shrink-0">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    >
      {({ close }) => (
        <div className="max-h-[320px] overflow-y-auto scrollbar-thin p-1.5">
          {options.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12px] text-[var(--fg-muted)]">
              No models reachable on the mesh right now.
            </div>
          ) : (
            options.map((m) => {
              const active = m.name === value;
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => {
                    onChange(m.name);
                    close();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-[13px] transition-colors",
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--fg)]"
                      : "text-[var(--fg-muted)] hover:bg-[var(--bg-elev-2)] hover:text-[var(--fg)]",
                  )}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]"
                    title="Reachable on the mesh"
                  />
                  <span className="flex-1 truncate text-[var(--fg)]">
                    {pretty(m.displayName || m.name)}
                  </span>
                  {active && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[var(--accent)]">
                      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })
          )}
          {!isPublicDeployment() && (
            <div className="mt-1 border-t border-[var(--border)] px-2.5 pt-2">
              <Link
                href="/models"
                onClick={close}
                className="text-[12px] text-[var(--accent)] hover:underline"
              >
                Manage models →
              </Link>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}
