"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { MODEL_CATALOG, type CatalogModel } from "../../lib/model-catalog";
import { useMeshStatus, type MeshModel } from "../../lib/use-mesh-status";
import { useMeshModels } from "../../lib/use-mesh-models";

type LocalModel = { id: string; sizeBytes: number | null };
type ListResp =
  | { ok: true; models: LocalModel[] }
  | { ok: false; message: string; models: LocalModel[] };

type DownloadEvent =
  | { kind: "stdout" | "stderr"; text: string }
  | { kind: "progress"; percent: number; bytes: number; total: number }
  | { kind: "done"; ok: boolean; code: number }
  | { kind: "error"; message: string };

type DownloadState = {
  id: string;
  phase: "running" | "done" | "failed";
  percent: number;
  bytes: number;
  total: number;
  lastLine: string;
  error?: string;
};

type StartupModel = {
  model: string;
  ctxSize?: number;
  forceSplit?: boolean;
};
type StartupResp =
  | {
      ok: true;
      models: StartupModel[];
      configPath: string;
      restart?: { ok: boolean; message: string };
    }
  | { ok: false; message: string };

const FAMILY_LABEL: Record<CatalogModel["family"], string> = {
  qwen: "Qwen",
  llama: "Llama",
  mistral: "Mistral",
  phi: "Phi",
  gemma: "Gemma",
};

const FAMILY_TINT: Record<CatalogModel["family"], string> = {
  qwen: "border-violet-400/40 bg-violet-400/10 text-violet-300",
  llama: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  mistral: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  phi: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  gemma: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

export default function ModelsPage() {
  const mesh = useMeshStatus();
  const meshModels = useMeshModels();
  const [local, setLocal] = useState<LocalModel[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>(
    {},
  );
  const [startup, setStartup] = useState<StartupModel[]>([]);
  const [startupBusy, setStartupBusy] = useState<string | null>(null);
  const [startupToast, setStartupToast] = useState<string | null>(null);

  const refreshLocal = useCallback(async () => {
    try {
      const res = await fetch("/api/control/models/list", {
        cache: "no-store",
      });
      const data = (await res.json()) as ListResp;
      setLocal(data.models);
      setListError(data.ok ? null : data.message);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "request failed");
    }
  }, []);

  const refreshStartup = useCallback(async () => {
    try {
      const res = await fetch("/api/control/models/startup", {
        cache: "no-store",
      });
      const data = (await res.json()) as StartupResp;
      if (data.ok) setStartup(data.models);
    } catch {
      // transient — keep last good
    }
  }, []);

  useEffect(() => {
    refreshLocal();
    refreshStartup();
    const id = setInterval(() => {
      refreshLocal();
      refreshStartup();
    }, 8000);
    return () => clearInterval(id);
  }, [refreshLocal, refreshStartup]);

  const setStartupModel = useCallback(
    async (
      id: string,
      opts: { forceSplit?: boolean } = {},
    ) => {
      setStartupBusy(id);
      setStartupToast(null);
      try {
        const res = await fetch("/api/control/models/startup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: id,
            forceSplit: opts.forceSplit === true ? true : undefined,
          }),
        });
        const data = (await res.json()) as StartupResp;
        if (data.ok) {
          setStartup(data.models);
          setStartupToast(
            data.restart?.message ??
              (opts.forceSplit
                ? `Saved. Restarting so ${id} runs across the mesh.`
                : `Saved. Restarting the runtime so ${id} loads on boot.`),
          );
        } else {
          setStartupToast(data.message);
        }
      } catch (e) {
        setStartupToast(e instanceof Error ? e.message : "request failed");
      } finally {
        setStartupBusy(null);
      }
    },
    [],
  );

  const clearStartupModels = useCallback(async () => {
    setStartupBusy("__clear");
    setStartupToast(null);
    try {
      const res = await fetch("/api/control/models/startup", {
        method: "DELETE",
      });
      const data = (await res.json()) as StartupResp;
      if (data.ok) {
        setStartup(data.models);
        setStartupToast(
          data.restart?.message ?? "Cleared startup models.",
        );
      } else {
        setStartupToast(data.message);
      }
    } catch (e) {
      setStartupToast(e instanceof Error ? e.message : "request failed");
    } finally {
      setStartupBusy(null);
    }
  }, []);

  const startDownload = useCallback(
    async (id: string) => {
      setDownloads((d) => ({
        ...d,
        [id]: {
          id,
          phase: "running",
          percent: 0,
          bytes: 0,
          total: 0,
          lastLine: "starting…",
        },
      }));

      const res = await fetch("/api/control/models/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!res.ok || !res.body) {
        let message = `request returned ${res.status}`;
        try {
          const err = (await res.json()) as { message?: string };
          message = err.message ?? message;
        } catch {
          // body is the stream — already consumed
        }
        setDownloads((d) => ({
          ...d,
          [id]: { ...d[id], phase: "failed", error: message },
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let okFinal: boolean | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line) continue;
          let ev: DownloadEvent;
          try {
            ev = JSON.parse(line) as DownloadEvent;
          } catch {
            continue;
          }
          setDownloads((d) => {
            const cur = d[id];
            if (!cur) return d;
            const next: DownloadState = { ...cur };
            if (ev.kind === "progress") {
              next.percent = ev.percent;
              next.bytes = ev.bytes;
              next.total = ev.total;
            } else if (ev.kind === "stdout" || ev.kind === "stderr") {
              next.lastLine = ev.text;
            } else if (ev.kind === "done") {
              next.phase = ev.ok ? "done" : "failed";
              next.percent = ev.ok ? 100 : next.percent;
              if (!ev.ok) next.error = `Download failed (exit ${ev.code}).`;
              okFinal = ev.ok;
            } else if (ev.kind === "error") {
              next.phase = "failed";
              next.error = ev.message;
              okFinal = false;
            }
            return { ...d, [id]: next };
          });
        }
      }

      if (okFinal) {
        await refreshLocal();
      }
    },
    [refreshLocal],
  );

  const localIds = new Set((local ?? []).map((m) => m.id));
  const localCatalog = MODEL_CATALOG.filter((m) => localIds.has(m.id));
  const remoteCatalog = MODEL_CATALOG.filter((m) => !localIds.has(m.id));
  const orphans =
    local?.filter((m) => !MODEL_CATALOG.find((c) => c.id === m.id)) ?? [];

  const selfNode = mesh.nodes.find((n) => n.isSelf);
  const localVramGb = selfNode?.capability.vramGb ?? selfNode?.vramGb ?? null;
  const localBackend = selfNode?.capability.backend ?? null;

  // Find a runtime-reported MeshModel for any catalog id by either name match
  // (the typical case once the runtime warms up) or substring match (the
  // runtime sometimes appends `-Q4_K_M` suffixes; we accept partial overlap).
  const findMeshModel = (id: string): MeshModel | null => {
    const exact = meshModels.models.find((m) => m.name === id);
    if (exact) return exact;
    return (
      meshModels.models.find(
        (m) => m.name.includes(id) || id.includes(m.name),
      ) ?? null
    );
  };

  const startupById = new Map(startup.map((s) => [s.model, s] as const));
  const startupIds = new Set(startup.map((s) => s.model));

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader
        title="Models"
        subtitle="Download a model onto your mesh. Start small — you can always upgrade later."
      />

      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
          {listError && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
              {listError}
            </div>
          )}

          <StartupBanner
            startup={startup}
            loaded={mesh.models}
            toast={startupToast}
            busy={startupBusy === "__clear"}
            onClear={clearStartupModels}
          />

          {mesh.models.length > 0 && (
            <Section
              title="Currently loaded"
              hint="In memory and ready to answer chat requests."
            >
              <ul className="divide-y divide-[var(--border)]">
                {mesh.models.map((m) => (
                  <li
                    key={m}
                    className="flex items-center justify-between py-3"
                  >
                    <span className="font-mono text-sm text-[var(--fg)]">
                      {m}
                    </span>
                    <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                      Loaded
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(localCatalog.length > 0 || orphans.length > 0) && (
            <Section
              title="On your mesh"
              hint="Already downloaded — pick one to load on boot."
            >
              <ul className="space-y-2">
                {localCatalog.map((m) => (
                  <CatalogRow
                    key={m.id}
                    model={m}
                    download={downloads[m.id] ?? null}
                    localVramGb={localVramGb}
                    localBackend={localBackend}
                    meshModel={findMeshModel(m.id)}
                    state="downloaded"
                    isStartup={startupIds.has(m.id)}
                    startupForceSplit={
                      startupById.get(m.id)?.forceSplit === true
                    }
                    startupBusy={startupBusy === m.id}
                    onDownload={() => startDownload(m.id)}
                    onSetStartup={(opts) => setStartupModel(m.id, opts)}
                  />
                ))}
                {orphans.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-elev-2)]/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm">{m.id}</div>
                      <div className="text-[11px] text-[var(--fg-muted)]">
                        Custom model — not in our catalog.
                      </div>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-3">
                      <span className="font-mono text-[11px] text-[var(--fg-muted)]">
                        {m.sizeBytes ? formatBytes(m.sizeBytes) : "—"}
                      </span>
                      <button
                        onClick={() => setStartupModel(m.id)}
                        disabled={startupBusy !== null}
                        className={
                          "rounded-md border px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 " +
                          (startupIds.has(m.id)
                            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                            : "border-[var(--border)] bg-[var(--bg-elev)] text-[var(--fg)] hover:border-[var(--accent)]/40")
                        }
                      >
                        {startupIds.has(m.id)
                          ? "Startup model"
                          : startupBusy === m.id
                            ? "Setting…"
                            : "Set as startup"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title="Catalog"
            hint="Hand-picked models that work well on ClosedMesh. Big ones run pooled across contributors — no single beefy box required."
          >
            <ul className="space-y-2">
              {remoteCatalog.map((m) => (
                <CatalogRow
                  key={m.id}
                  model={m}
                  download={downloads[m.id] ?? null}
                  localVramGb={localVramGb}
                  localBackend={localBackend}
                  meshModel={findMeshModel(m.id)}
                  state="catalog"
                  isStartup={startupIds.has(m.id)}
                  startupForceSplit={
                    startupById.get(m.id)?.forceSplit === true
                  }
                  startupBusy={startupBusy === m.id}
                  onDownload={() => startDownload(m.id)}
                  onSetStartup={(opts) => setStartupModel(m.id, opts)}
                />
              ))}
            </ul>
          </Section>
        </div>
      </main>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">
          {title}
        </div>
        <div className="mt-0.5 text-[12px] text-[var(--fg-muted)]">{hint}</div>
      </div>
      {children}
    </section>
  );
}

function StartupBanner({
  startup,
  loaded,
  toast,
  busy,
  onClear,
}: {
  startup: StartupModel[];
  loaded: string[];
  toast: string | null;
  busy: boolean;
  onClear: () => void;
}) {
  if (startup.length === 0 && loaded.length === 0 && !toast) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
        <div className="text-[10px] uppercase tracking-[0.16em] text-amber-300">
          No startup model
        </div>
        <div className="mt-1 text-sm text-[var(--fg)]">
          Pick a downloaded model below and tap{" "}
          <span className="font-semibold">Set as startup</span> — it will load
          on boot and start serving the public mesh.
        </div>
      </div>
    );
  }

  if (startup.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">
              Startup model
            </div>
            <div className="mt-1 text-sm text-[var(--fg-muted)]">
              No model is configured to load on boot. Set one below so the
              runtime keeps serving after a restart.
            </div>
          </div>
        </div>
        {toast && (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2 text-xs text-[var(--fg-muted)]">
            {toast}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300">
            Startup model
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {startup.map((s) => (
              <span
                key={s.model}
                className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-0.5 font-mono text-[12px] text-emerald-200"
              >
                {s.model}
                {s.ctxSize ? ` · ctx ${s.ctxSize}` : ""}
              </span>
            ))}
          </div>
          <div className="mt-2 text-[12px] text-[var(--fg-muted)]">
            Loaded automatically every time the autostart service comes up.
          </div>
        </div>
        <button
          onClick={onClear}
          disabled={busy}
          className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1.5 text-[11px] font-medium text-[var(--fg-muted)] transition hover:border-amber-400/40 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Clearing…" : "Clear"}
        </button>
      </div>
      {toast && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2 text-xs text-[var(--fg-muted)]">
          {toast}
        </div>
      )}
    </div>
  );
}

type MeshFitState =
  | { kind: "unknown" }
  | { kind: "solo"; localVramGb: number }
  | {
      kind: "pooled";
      contributorCount: number;
      pooledVramGb: number;
      neededVramGb: number;
    }
  | {
      kind: "needs_more";
      pooledVramGb: number;
      neededVramGb: number;
      shortfallGb: number;
      eligiblePeerCount: number;
    };

/**
 * Three-state mesh-aware fit determination. Replaces the old "Won't fit on
 * this Mac" badge with the swarm-aware "does the mesh fit this model right
 * now" question.
 *
 * Source of truth, in order of preference:
 *   1. The runtime's `MeshModel.meshFit` — pre-computed, RTT-aware, peer
 *      VRAM-aware. This is the right answer when available.
 *   2. Catalog `minVramGb` against local VRAM — fallback when the model
 *      isn't yet warm/known to the runtime. The fallback intentionally
 *      doesn't synthesize peer pooling since we'd need same-backend
 *      filtering and RTT data the catalog doesn't have.
 */
function determineMeshFit(
  catalog: CatalogModel,
  meshModel: MeshModel | null,
  localVramGb: number | null,
  localBackend: string | null,
): MeshFitState {
  if (meshModel?.meshFit) {
    const fit = meshModel.meshFit;
    if (fit.fitsOnLargestNode) {
      return {
        kind: "solo",
        localVramGb: localVramGb ?? meshModel.meshVramGb,
      };
    }
    if (fit.fitsPooled) {
      return {
        kind: "pooled",
        contributorCount: fit.eligiblePeerCount,
        pooledVramGb: fit.pooledVramGb,
        neededVramGb: fit.neededVramGb,
      };
    }
    return {
      kind: "needs_more",
      pooledVramGb: fit.pooledVramGb,
      neededVramGb: fit.neededVramGb,
      shortfallGb: Math.max(0, fit.neededVramGb - fit.pooledVramGb),
      eligiblePeerCount: fit.eligiblePeerCount,
    };
  }

  // Fallback when the runtime doesn't yet know about this model.
  if (localVramGb == null) return { kind: "unknown" };
  const fitsLocal =
    localVramGb >= catalog.minVramGb ||
    (catalog.cpuOk && (localBackend === "cpu" || localVramGb < 1));
  if (fitsLocal) return { kind: "solo", localVramGb };
  return {
    kind: "needs_more",
    pooledVramGb: localVramGb,
    neededVramGb: catalog.minVramGb,
    shortfallGb: Math.max(0, catalog.minVramGb - localVramGb),
    eligiblePeerCount: 1,
  };
}

function CatalogRow({
  model,
  download,
  localVramGb,
  localBackend,
  meshModel,
  state,
  isStartup,
  startupForceSplit,
  startupBusy,
  onDownload,
  onSetStartup,
}: {
  model: CatalogModel;
  download: DownloadState | null;
  localVramGb: number | null;
  localBackend: string | null;
  meshModel: MeshModel | null;
  state: "downloaded" | "catalog";
  isStartup: boolean;
  startupForceSplit: boolean;
  startupBusy: boolean;
  onDownload: () => void;
  onSetStartup: (opts?: { forceSplit?: boolean }) => void;
}) {
  const fit = determineMeshFit(model, meshModel, localVramGb, localBackend);
  const downloading = download?.phase === "running";
  const downloadFailed = download?.phase === "failed";

  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev-2)]/40 p-4 transition hover:border-[var(--accent)]/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tracking-tight text-[var(--fg)]">
              {model.name}
            </span>
            <span
              className={
                "rounded-full border px-2 py-0.5 text-[10px] font-medium " +
                FAMILY_TINT[model.family]
              }
            >
              {FAMILY_LABEL[model.family]}
            </span>
            {model.recommended && (
              <span className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                Recommended
              </span>
            )}
            {state === "downloaded" && (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                On your mesh
              </span>
            )}
            {isStartup && (
              <span
                className="rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300"
                title="This model is loaded automatically when the runtime starts."
              >
                Startup model
              </span>
            )}
            <MeshFitBadge fit={fit} />
            {model.cpuOk && (
              <span className="rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-muted)]">
                CPU-friendly
              </span>
            )}
          </div>
          <div className="mt-1.5 max-w-2xl text-[13px] text-[var(--fg-muted)]">
            {model.description}
          </div>
          <MeshFitDetail fit={fit} model={model} />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--fg-muted)]">
            <span>
              <span className="text-[var(--fg)]">{model.sizeGb} GB</span> on
              disk
            </span>
            <span aria-hidden>·</span>
            <span>
              needs <span className="text-[var(--fg)]">{model.minVramGb} GB</span>{" "}
              memory
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {state === "downloaded" ? (
            <button
              onClick={() => onSetStartup()}
              disabled={startupBusy || isStartup}
              className={
                "rounded-lg px-4 py-2 text-xs font-semibold transition disabled:cursor-not-allowed " +
                (isStartup
                  ? "border border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "bg-[var(--accent)] text-black shadow-[0_8px_24px_-12px_rgba(255,122,69,0.7)] hover:brightness-110 disabled:opacity-40 disabled:shadow-none")
              }
            >
              {isStartup
                ? "Startup model"
                : startupBusy
                  ? "Setting…"
                  : "Set as startup"}
            </button>
          ) : (
            <button
              onClick={onDownload}
              disabled={downloading}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-black shadow-[0_8px_24px_-12px_rgba(255,122,69,0.7)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {downloading
                ? `Downloading… ${download!.percent.toFixed(0)}%`
                : downloadFailed
                  ? "Try again"
                  : "Download"}
            </button>
          )}
        </div>
      </div>

      {state === "downloaded" && isStartup && (
        <RunOnMeshToggle
          model={model}
          meshModel={meshModel}
          forceSplit={startupForceSplit}
          busy={startupBusy}
          onChange={(next) =>
            onSetStartup({ forceSplit: next ? true : undefined })
          }
        />
      )}

      {download && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2.5">
          <div className="mb-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className={
                "h-full transition-all " +
                (download.phase === "failed"
                  ? "bg-red-400"
                  : download.phase === "done"
                    ? "bg-emerald-400"
                    : "bg-[var(--accent)]")
              }
              style={{ width: `${Math.max(2, download.percent)}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--fg-muted)]">
            <span className="truncate font-mono" title={download.lastLine}>
              {download.error ?? download.lastLine}
            </span>
            <span className="shrink-0 font-mono">
              {download.total > 0
                ? `${formatBytes(download.bytes)} / ${formatBytes(download.total)}`
                : `${download.percent.toFixed(0)}%`}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/**
 * Tiny pill describing how a model relates to current mesh capacity. Three
 * faces: solo / pooled / needs more contributors. The previous "Won't fit
 * on this Mac" badge was misleading because it ignored the swarm — this
 * replaces it with the swarm-aware question.
 */
function MeshFitBadge({ fit }: { fit: MeshFitState }) {
  if (fit.kind === "unknown") return null;

  if (fit.kind === "solo") {
    return (
      <span
        className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300"
        title={`Fits on this Mac alone (${fit.localVramGb.toFixed(1)} GB).`}
      >
        Fits on this Mac
      </span>
    );
  }

  if (fit.kind === "pooled") {
    return (
      <span
        className="rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium text-sky-300"
        title={`Pooled across ${fit.contributorCount} contributors (${fit.pooledVramGb.toFixed(1)} GB total, needs ${fit.neededVramGb.toFixed(1)} GB).`}
      >
        Fits on the mesh
      </span>
    );
  }

  return (
    <span
      className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300"
      title={`Mesh has ${fit.pooledVramGb.toFixed(1)} GB so far; needs ${fit.neededVramGb.toFixed(1)} GB to load.`}
    >
      Needs more contributors
    </span>
  );
}

/** Long-form detail line under a catalog row, expanding the badge. */
function MeshFitDetail({
  fit,
  model,
}: {
  fit: MeshFitState;
  model: CatalogModel;
}) {
  if (fit.kind === "unknown") return null;

  if (fit.kind === "solo") {
    return (
      <div className="mt-1.5 text-[11px] text-emerald-300/90">
        Will run on this Mac alone — {model.minVramGb} GB headroom available.
      </div>
    );
  }

  if (fit.kind === "pooled") {
    const contributors = fit.contributorCount;
    return (
      <div className="mt-1.5 text-[11px] text-sky-300/90">
        Will run pooled across {contributors}{" "}
        {contributors === 1 ? "contributor" : "contributors"} —{" "}
        {fit.pooledVramGb.toFixed(1)} GB combined memory covers the{" "}
        {fit.neededVramGb.toFixed(1)} GB required.
      </div>
    );
  }

  const ask =
    fit.shortfallGb >= 1
      ? `${Math.ceil(fit.shortfallGb)} GB`
      : `${fit.shortfallGb.toFixed(1)} GB`;
  return (
    <div className="mt-1.5 text-[11px] text-amber-300/90">
      Mesh has {fit.pooledVramGb.toFixed(1)} of {fit.neededVramGb.toFixed(1)} GB
      so far — needs {ask} more to load. Invite a friend or spin up another
      node to unlock this model.
    </div>
  );
}

/**
 * "Run on the mesh" per-model toggle. Visible on the downloaded + startup
 * row so the user can opt the model into pipeline-parallel mode (writes
 * `force_split = true` to its `[[models]]` block).
 *
 * Gated to MoE models that would split below the viability floor described
 * in `closedmesh-llm/closedmesh/docs/MoE_SPLIT_REPORT.md` — splitting MoEs
 * with too few experts per shard produces garbage output, so we'd rather
 * surface the constraint than let users foot-gun.
 */
function RunOnMeshToggle({
  model,
  meshModel,
  forceSplit,
  busy,
  onChange,
}: {
  model: CatalogModel;
  meshModel: MeshModel | null;
  forceSplit: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  // Heuristic MoE viability floor: report says shards with fewer than ~64
  // experts produce coherent output. We use the runtime's reported expert
  // count when available (more accurate than the catalog), or skip the
  // gate when we don't know the shape of the model yet.
  const expertCount = meshModel?.expertCount ?? null;
  const eligiblePeers = meshModel?.meshFit?.eligiblePeerCount ?? 1;
  const proposedShards = Math.max(2, eligiblePeers);
  const expertsPerShard =
    expertCount && proposedShards > 0 ? expertCount / proposedShards : null;
  const moeUnsafe =
    meshModel?.moe === true &&
    expertsPerShard !== null &&
    expertsPerShard < 64;

  const explainer = moeUnsafe
    ? `MoE models need at least ~64 experts per shard for coherent output. With the current mesh (${proposedShards} shards × ${expertCount ?? "?"} experts) this would split into ${expertsPerShard?.toFixed(0) ?? "?"} experts per shard — too low.`
    : forceSplit
      ? "On: this model launches pipeline-parallel even when one box could fit it solo."
      : "Off: the runtime decides per-launch (solo when possible, split when required).";

  const disabled = busy || moeUnsafe;

  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)]/60 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-[var(--fg)]">
          Run on the mesh
        </div>
        <div className="mt-0.5 max-w-md text-[11px] text-[var(--fg-muted)]">
          {explainer}
        </div>
        <div className="mt-1 text-[10px] text-[var(--fg-muted)]/80">
          Touches{" "}
          <span className="font-mono">force_split = true</span> in{" "}
          <span className="font-mono">~/.closedmesh/config.toml</span> for
          this model.
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={forceSplit}
        aria-label={`Run ${model.name} on the mesh`}
        disabled={disabled}
        onClick={() => onChange(!forceSplit)}
        className={
          "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 " +
          (forceSplit
            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
            : "border-[var(--border)] bg-[var(--bg-elev)] text-[var(--fg-muted)] hover:border-[var(--accent)]/40 hover:text-[var(--fg)]")
        }
      >
        {busy ? "Saving…" : forceSplit ? "On" : "Off"}
      </button>
    </div>
  );
}
