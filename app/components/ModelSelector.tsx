"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMeshModels } from "../lib/use-mesh-models";
import { useMeshStatus } from "../lib/use-mesh-status";
import type { MeshModel } from "../lib/use-mesh-status";
import {
  DEFAULT_DAILY_DRIVER_MODEL,
  TIER_DESCRIPTIONS,
  TIER_LABELS,
  getModelTier,
  type ModelTier,
} from "../lib/model-tiers";
import {
  bestPeerMetrics,
  formatPickerTps,
  formatPickerTtft,
  type ModelPickerMetrics,
} from "../lib/model-picker-fitness";
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

/**
 * Models the chat composer may offer: ready supply (`chatViable`), not
 * merely dialable inventory. Fall back to `selectable` on older payloads.
 */
function offerableModels(models: MeshModel[]): MeshModel[] {
  return models.filter((m) =>
    typeof m.chatViable === "boolean" ? m.chatViable : m.selectable === true,
  );
}

/**
 * Pick a sensible default when nothing is chosen yet. Always a daily-driver —
 * never auto-select a slow capacity-tier model. See the original rationale
 * retained from the previous select implementation.
 */
function pickDefault(models: MeshModel[]): string | undefined {
  const options = offerableModels(models);
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

function isOfferable(m: MeshModel): boolean {
  return typeof m.chatViable === "boolean" ? m.chatViable : m.selectable === true;
}

function tierOf(m: MeshModel): ModelTier {
  return getModelTier(m.name);
}

export type ModelSelectorProps = {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
};

/**
 * Calm model switcher for the chat composer: a quiet button showing the active
 * model that opens a popover list, rather than a cramped native `<select>`.
 * Daily drivers first; capacity / experimental behind an explicit expand.
 * Live TTFT/tok-s from /status; confirm when below the interactive bar.
 */
export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const { loading, models } = useMeshModels();
  const { nodes } = useMeshStatus();
  const options = offerableModels(models);
  const [showSlow, setShowSlow] = useState(false);
  const [pending, setPending] = useState<{
    name: string;
    metrics: ModelPickerMetrics;
  } | null>(null);

  const metricsByName = useMemo(() => {
    const map = new Map<string, ModelPickerMetrics>();
    for (const m of options) {
      map.set(m.name, bestPeerMetrics(m.name, nodes));
    }
    return map;
  }, [options, nodes]);

  const daily = options.filter((m) => tierOf(m) === "daily_driver");
  const slow = options.filter((m) => tierOf(m) !== "daily_driver");

  // If the current selection is capacity/experimental, keep that section open.
  useEffect(() => {
    if (!value) return;
    if (getModelTier(value) !== "daily_driver") setShowSlow(true);
  }, [value]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (value !== undefined) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // Only restore a stored id if it is still chat-viable — otherwise we
    // would pin the composer on a model that 503s until the next effect.
    if (stored && models.some((m) => m.name === stored && isOfferable(m))) {
      onChange(stored);
    }
  }, [value, onChange, models]);

  useEffect(() => {
    if (loading) return;
    const available = offerableModels(models);
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

  function select(name: string) {
    onChange(name);
    setPending(null);
  }

  function requestSelect(name: string, close: () => void) {
    const metrics = metricsByName.get(name) ?? bestPeerMetrics(name, nodes);
    if (metrics.belowInteractiveBar) {
      setPending({ name, metrics });
      return;
    }
    select(name);
    close();
  }

  return (
    <Popover
      side="top"
      align="end"
      width={320}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
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
        <div className="max-h-[360px] overflow-y-auto scrollbar-thin p-1.5">
          {options.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12px] text-[var(--fg-muted)]">
              No models ready to serve on the mesh right now.
            </div>
          ) : pending ? (
            <ConfirmSlow
              name={pending.name}
              metrics={pending.metrics}
              onCancel={() => setPending(null)}
              onConfirm={() => {
                select(pending.name);
                close();
              }}
            />
          ) : (
            <>
              {daily.length > 0 && (
                <SectionLabel>
                  {TIER_LABELS.daily_driver}
                </SectionLabel>
              )}
              {daily.map((m) => (
                <ModelRow
                  key={m.name}
                  model={m}
                  active={m.name === value}
                  metrics={metricsByName.get(m.name)}
                  onSelect={() => requestSelect(m.name, close)}
                />
              ))}

              {slow.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowSlow((v) => !v)}
                    className="mt-1 flex w-full items-center justify-between rounded-[var(--radius-md)] px-2.5 py-2 text-left text-[12px] text-[var(--fg-muted)] hover:bg-[var(--bg-elev-2)] hover:text-[var(--fg)]"
                  >
                    <span>
                      Bigger / slower
                      <span className="ml-1.5 text-[11px] opacity-70">
                        ({slow.length})
                      </span>
                    </span>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      fill="none"
                      className={cn(
                        "shrink-0 transition-transform",
                        showSlow && "rotate-180",
                      )}
                    >
                      <path
                        d="M3 4.5L6 7.5L9 4.5"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  {showSlow && (
                    <>
                      <p className="px-2.5 pb-1.5 text-[11px] leading-snug text-[var(--fg-muted)]">
                        {TIER_DESCRIPTIONS.capacity}
                      </p>
                      {slow.map((m) => (
                        <ModelRow
                          key={m.name}
                          model={m}
                          active={m.name === value}
                          metrics={metricsByName.get(m.name)}
                          onSelect={() => requestSelect(m.name, close)}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </>
          )}
          {!isPublicDeployment() && !pending && (
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--fg-muted)]">
      {children}
    </div>
  );
}

function ModelRow({
  model,
  active,
  metrics,
  onSelect,
}: {
  model: MeshModel;
  active: boolean;
  metrics: ModelPickerMetrics | undefined;
  onSelect: () => void;
}) {
  const tier = getModelTier(model.name);
  const slow = metrics?.belowInteractiveBar === true;
  const speed =
    metrics?.hasSamples
      ? `${formatPickerTps(metrics.bestTps)} · ${formatPickerTtft(metrics.bestTtftMs)}`
      : "no samples yet";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-[13px] transition-colors",
        active
          ? "bg-[var(--accent-soft)] text-[var(--fg)]"
          : "text-[var(--fg-muted)] hover:bg-[var(--bg-elev-2)] hover:text-[var(--fg)]",
      )}
    >
      <span
        className={cn(
          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
          slow ? "bg-[var(--warn)]" : "bg-[var(--success)]",
        )}
        title={
          slow
            ? "Reachable, below interactive speed"
            : "Reachable on the mesh"
        }
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[var(--fg)]">
            {pretty(model.displayName || model.name)}
          </span>
          {tier !== "daily_driver" && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--fg-muted)]">
              {TIER_LABELS[tier]}
            </span>
          )}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-[11px] tabular-nums",
            slow ? "text-[var(--warn)]" : "text-[var(--fg-muted)]",
          )}
        >
          {speed}
        </span>
      </span>
      {active && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className="mt-0.5 shrink-0 text-[var(--accent)]"
        >
          <path
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function ConfirmSlow({
  name,
  metrics,
  onCancel,
  onConfirm,
}: {
  name: string;
  metrics: ModelPickerMetrics;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="px-2.5 py-2">
      <p className="text-[13px] font-medium text-[var(--fg)]">
        {pretty(name)} is slow on the mesh right now
      </p>
      <p className="mt-1 text-[12px] leading-snug text-[var(--fg-muted)]">
        Best peer: {formatPickerTps(metrics.bestTps)} ·{" "}
        {formatPickerTtft(metrics.bestTtftMs)}. You still get this model — not
        a substitute — but expect a long wait.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--fg-muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 rounded-[var(--radius-md)] bg-[var(--accent)] px-2.5 py-1.5 text-[12px] text-[var(--accent-fg,#fff)] hover:opacity-90"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
