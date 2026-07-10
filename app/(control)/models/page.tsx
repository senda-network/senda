"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { type CatalogModel } from "../../lib/model-catalog";
import { useCatalog } from "../../lib/use-catalog";
import { useMeshStatus, type MeshModel } from "../../lib/use-mesh-status";
import { useMeshModels } from "../../lib/use-mesh-models";
import { modelIdsMatch, normalizeModelId } from "../../lib/model-id";
import { LiveLaunchState } from "../../components/LiveLaunchState";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import {
  useDownloads,
  type DownloadState,
} from "../../lib/downloads-context";

type LocalModel = { id: string; sizeBytes: number | null };
type ListResp =
  | { ok: true; models: LocalModel[] }
  | { ok: false; message: string; models: LocalModel[] };

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
  deepseek: "DeepSeek",
  glm: "GLM",
};

export default function ModelsPage() {
  const mesh = useMeshStatus();
  const meshModels = useMeshModels();
  const { catalog } = useCatalog();
  const [local, setLocal] = useState<LocalModel[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const { downloads, startDownload, setOnComplete } = useDownloads();
  const [startup, setStartup] = useState<StartupModel[]>([]);
  const [startupBusy, setStartupBusy] = useState<string | null>(null);
  const [startupToast, setStartupToast] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);
  const [deleteToast, setDeleteToast] = useState<string | null>(null);

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

  const deleteModel = useCallback(
    async (id: string) => {
      setDeleteBusy(id);
      setDeleteToast(null);
      try {
        const res = await fetch("/api/control/models/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          message?: string;
          reclaimedHuman?: string;
          deletedPaths?: string[];
        };
        if (data.ok) {
          const reclaimed = data.reclaimedHuman ?? "—";
          const fileCount = data.deletedPaths?.length ?? 0;
          setDeleteToast(
            `Deleted ${id} (reclaimed ${reclaimed}${fileCount > 1 ? `, ${fileCount} files` : ""}).`,
          );
          // Local list polls every 8s; refresh immediately so the row
          // disappears without waiting for the next tick.
          await refreshLocal();
        } else {
          setDeleteToast(data.message ?? "Delete failed.");
        }
      } catch (e) {
        setDeleteToast(e instanceof Error ? e.message : "request failed");
      } finally {
        setDeleteBusy(null);
      }
    },
    [refreshLocal],
  );

  // The actual download lifecycle lives in `<DownloadsProvider>` (see
  // `app/lib/downloads-context.tsx`) so progress survives navigation
  // between control routes. This page just registers a one-shot
  // on-complete callback that fires the local-list refresh whenever a
  // download finishes successfully — even if the user is currently on a
  // different page when that happens, the next mount of ModelsPage picks
  // up the freshly-installed model from `refreshLocal()` immediately
  // rather than waiting for the 8 s poll.
  useEffect(() => {
    setOnComplete((id) => {
      void id;
      void refreshLocal();
    });
    return () => setOnComplete(null);
  }, [refreshLocal, setOnComplete]);

  // Match catalog ids against the runtime's installed-model ids using a
  // normalized form (case-folded, dots/underscores collapsed to dashes,
  // `.gguf` stripped). The runtime resolves a catalog ref like
  // `Mixtral-8x7B-Instruct-v0.1-Q5_K_M` to a real HF filename and stores
  // the model under that filename's stem (`Mixtral-8x7B-Instruct-v0.1.q5_k_m`
  // for TheBloke / mradermacher), so a strict equality check would
  // banish the model to the "Custom — not in our catalog" orphan bucket
  // even though we just downloaded it from the catalog. See
  // app/lib/model-id.ts for the normalization rules.
  const localIdsNormalized = new Set(
    (local ?? []).map((m) => normalizeModelId(m.id)),
  );
  const localCatalog = catalog.filter((m) =>
    localIdsNormalized.has(normalizeModelId(m.id)),
  );
  const remoteCatalog = catalog.filter(
    (m) => !localIdsNormalized.has(normalizeModelId(m.id)),
  );
  const orphans =
    local?.filter((m) => !catalog.some((c) => modelIdsMatch(c.id, m.id))) ?? [];

  const selfNode = mesh.nodes.find((n) => n.isSelf);
  const localVramGb = selfNode?.capability.vramGb ?? selfNode?.vramGb ?? null;
  const localBackend = selfNode?.capability.backend ?? null;
  const selfHostname = selfNode?.hostname ?? null;

  // Find a runtime-reported MeshModel for any catalog id. First try exact
  // match, then a normalized (case + separator-folded) match — same
  // rationale as the orphan/local matching above, since the runtime can
  // also report the same model under either the catalog ref or the
  // resolved HF filename stem depending on whether the model is loaded
  // or just available. Substring fallback as a last resort for
  // historical `-Q4_K_M` suffix variations.
  const findMeshModel = (id: string): MeshModel | null => {
    const exact = meshModels.models.find((m) => m.name === id);
    if (exact) return exact;
    const normalized = meshModels.models.find((m) =>
      modelIdsMatch(m.name, id),
    );
    if (normalized) return normalized;
    return (
      meshModels.models.find(
        (m) => m.name.includes(id) || id.includes(m.name),
      ) ?? null
    );
  };

  // Index startup configs by both the raw id and a normalized id, so a
  // catalog row matches whether the user configured it via the catalog
  // ref (`Mixtral-8x7B-Instruct-v0.1-Q5_K_M`) or via the resolved HF
  // filename stem (`Mixtral-8x7B-Instruct-v0.1.q5_k_m`). Without this,
  // the catalog row would lose its "Startup model" pill the moment the
  // runtime restarts and re-keys the startup entry under the resolved
  // filename. See app/lib/model-id.ts.
  const startupById = new Map(startup.map((s) => [s.model, s] as const));
  const startupNormalizedToEntry = new Map(
    startup.map((s) => [normalizeModelId(s.model), s] as const),
  );
  const isStartupModel = (id: string) =>
    startupById.has(id) || startupNormalizedToEntry.has(normalizeModelId(id));
  const startupEntryFor = (id: string) =>
    startupById.get(id) ?? startupNormalizedToEntry.get(normalizeModelId(id));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Models"
        subtitle="Download a model onto your mesh. Start small — you can always upgrade later."
      />

      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
          {listError && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--warn)]/30 bg-[var(--warn-soft)] px-4 py-3 text-xs text-[var(--warn)]">
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

          {(() => {
            // A startup-configured model that the runtime hasn't yet
            // brought up gets surfaced as "waiting to load" with the
            // live planner reason (capacity short, still mmap'ing, …).
            // This is the case where the user clicks "Set as startup" on
            // a 70 B model, the bounce succeeds, but no llama-server
            // comes up because pooled VRAM is short — without this
            // section there's no UI signal at all and the dashboard just
            // looks idle.
            const loadedSet = new Set(mesh.models);
            const waiting = startup
              .map((s) => s.model)
              .filter((id) => !loadedSet.has(id));
            if (mesh.models.length === 0 && waiting.length === 0) return null;
            return (
              <Section
                title="Currently loaded"
                hint="What the runtime is actually doing right now."
              >
                <ul className="divide-y divide-[var(--border)]">
                  {mesh.models.map((m) => (
                    <li
                      key={m}
                      className="flex flex-wrap items-center justify-between gap-2 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm text-[var(--fg)]">
                          {m}
                        </div>
                        <div className="mt-1">
                          <LiveLaunchState
                            meshModel={findMeshModel(m)}
                            isLoaded
                            isConfigured={isStartupModel(m)}
                            selfHostname={selfHostname}
                          />
                        </div>
                      </div>
                      <Badge tone="success" dot>
                        Loaded
                      </Badge>
                    </li>
                  ))}
                  {waiting.map((m) => (
                    <li
                      key={`waiting-${m}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm text-[var(--fg)]">
                          {m}
                        </div>
                        <div className="mt-1">
                          <LiveLaunchState
                            meshModel={findMeshModel(m)}
                            isLoaded={false}
                            isConfigured
                            selfHostname={selfHostname}
                          />
                        </div>
                      </div>
                      <Badge tone="warn" dot>
                        Waiting
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Section>
            );
          })()}

          {(localCatalog.length > 0 || orphans.length > 0) && (
            <Section
              title="On your mesh"
              hint="Already downloaded — pick one to load on boot, or free up disk by deleting one."
            >
              {deleteToast && (
                <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2 text-xs text-[var(--fg-muted)]">
                  {deleteToast}
                </div>
              )}
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
                    isStartup={isStartupModel(m.id)}
                    startupForceSplit={
                      startupEntryFor(m.id)?.forceSplit === true
                    }
                    startupBusy={startupBusy === m.id}
                    deleteBusy={deleteBusy === m.id}
                    sizeBytes={
                      local?.find((lm) => modelIdsMatch(lm.id, m.id))
                        ?.sizeBytes ?? null
                    }
                    onDownload={() =>
                      startDownload(m.id, Math.round(m.sizeGb * 1024 ** 3))
                    }
                    onSetStartup={(opts) => setStartupModel(m.id, opts)}
                    onDelete={() => deleteModel(m.id)}
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
                          (isStartupModel(m.id)
                            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                            : "border-[var(--border)] bg-[var(--bg-elev)] text-[var(--fg)] hover:border-[var(--accent)]/40")
                        }
                      >
                        {isStartupModel(m.id)
                          ? "Startup model"
                          : startupBusy === m.id
                            ? "Setting…"
                            : "Set as startup"}
                      </button>
                      <DeleteButton
                        busy={deleteBusy === m.id}
                        disabled={isStartupModel(m.id) || deleteBusy !== null}
                        disabledReason={
                          isStartupModel(m.id)
                            ? "Currently set as the startup model — clear startup first."
                            : null
                        }
                        sizeBytes={m.sizeBytes}
                        onConfirm={() => deleteModel(m.id)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title="Catalog"
            hint="Hand-picked models that work well on Senda. Big ones run pooled across contributors — no single beefy box required."
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
                  isStartup={isStartupModel(m.id)}
                  startupForceSplit={
                    startupEntryFor(m.id)?.forceSplit === true
                  }
                  startupBusy={startupBusy === m.id}
                  onDownload={() =>
                    startDownload(m.id, Math.round(m.sizeGb * 1024 ** 3))
                  }
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
  deleteBusy = false,
  sizeBytes = null,
  onDownload,
  onSetStartup,
  onDelete,
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
  deleteBusy?: boolean;
  sizeBytes?: number | null;
  onDownload: () => void;
  onSetStartup: (opts?: { forceSplit?: boolean }) => void;
  onDelete?: () => void;
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
            {/* One clear primary signal: how well it fits the mesh. */}
            <MeshFitBadge fit={fit} />
            {model.recommended && <Badge tone="accent">Recommended</Badge>}
            {isStartup && (
              <span title="Loaded automatically when the runtime starts">
                <Badge tone="success" dot>
                  Startup
                </Badge>
              </span>
            )}
          </div>
          <div className="mt-1.5 max-w-2xl text-[13px] text-[var(--fg-muted)]">
            {model.description}
          </div>
          <MeshFitDetail fit={fit} model={model} />
          {/* Secondary detail demoted to a quiet meta line. */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--fg-muted)]">
            <span className="text-[var(--fg-subtle)]">
              {FAMILY_LABEL[model.family]}
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="text-[var(--fg)]">{model.sizeGb} GB</span> on disk
            </span>
            <span aria-hidden>·</span>
            <span>
              needs <span className="text-[var(--fg)]">{model.minVramGb} GB</span>{" "}
              memory
            </span>
            {model.cpuOk && (
              <>
                <span aria-hidden>·</span>
                <span>runs on CPU</span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {state === "downloaded" ? (
            <>
              {isStartup ? (
                <Badge tone="success" dot>
                  Startup model
                </Badge>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onSetStartup()}
                  disabled={startupBusy}
                >
                  {startupBusy ? "Setting…" : "Set as startup"}
                </Button>
              )}
              {onDelete && (
                <DeleteButton
                  busy={deleteBusy}
                  disabled={isStartup || startupBusy}
                  disabledReason={
                    isStartup
                      ? "This is the startup model — clear it from the banner above first."
                      : null
                  }
                  sizeBytes={sizeBytes}
                  onConfirm={onDelete}
                />
              )}
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={onDownload}
              disabled={downloading}
            >
              {downloading
                ? `Downloading… ${download!.percent.toFixed(0)}%`
                : downloadFailed
                  ? "Try again"
                  : "Download"}
            </Button>
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
 * Two-click destructive action for deleting a downloaded model.
 *
 * Why a two-click pattern instead of `window.confirm()`: the native
 * dialog is jarring inside a Tauri webview (steals focus, looks
 * different on each OS) and gives no visual hint of what's about to
 * happen. The expand-then-confirm pattern keeps everything inline
 * and shows the size that'll be reclaimed.
 *
 * Disarm strategy:
 *   1. Clicking anywhere outside the armed widget cancels — the
 *      common "wandered off" case, instant feedback, no waiting.
 *   2. A 15 s safety timer is the backstop for the genuinely abandoned
 *      case (e.g. user closed the laptop mid-flow). The earlier
 *      version used 4 s, which routinely fired between the user
 *      clicking Delete and reaching for Confirm — they'd then click
 *      a freshly-rendered "Delete" button by accident, arming it
 *      again and creating the impression "Confirm doesn't work".
 *      15 s is generous enough to read "Confirm · free 5.00 GB",
 *      think about it, and act, without being so long the row
 *      sits armed forever.
 */
function DeleteButton({
  busy,
  disabled,
  disabledReason,
  sizeBytes,
  onConfirm,
}: {
  busy: boolean;
  disabled: boolean;
  disabledReason: string | null;
  sizeBytes: number | null;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 15_000);
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (
        target instanceof Node &&
        armedRef.current &&
        !armedRef.current.contains(target)
      ) {
        setArmed(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [armed]);

  if (busy) {
    return (
      <span className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] px-2.5 py-1 text-[11px] font-medium text-[var(--fg-muted)]">
        Deleting…
      </span>
    );
  }

  if (armed) {
    return (
      <span
        ref={armedRef}
        className="inline-flex items-center gap-1 rounded-md border border-red-400/40 bg-red-500/10 p-0.5 text-[11px] font-medium"
      >
        <button
          type="button"
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
          className="rounded px-2 py-0.5 text-red-200 transition hover:bg-red-500/20"
        >
          Confirm{sizeBytes ? ` · free ${formatBytes(sizeBytes)}` : ""}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="rounded px-2 py-0.5 text-[var(--fg-muted)] transition hover:text-[var(--fg)]"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setArmed(true)}
      disabled={disabled}
      title={disabledReason ?? "Delete this model from disk"}
      className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] px-2.5 py-1 text-[11px] font-medium text-[var(--fg-muted)] transition hover:border-red-400/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--fg-muted)]"
    >
      Delete
    </button>
  );
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
      <span title={`Fits on this Mac alone (${fit.localVramGb.toFixed(1)} GB).`}>
        <Badge tone="success">Fits on this Mac</Badge>
      </span>
    );
  }

  if (fit.kind === "pooled") {
    return (
      <span
        title={`Pooled across ${fit.contributorCount} contributors (${fit.pooledVramGb.toFixed(1)} GB total, needs ${fit.neededVramGb.toFixed(1)} GB).`}
      >
        <Badge tone="info">Fits on the mesh</Badge>
      </span>
    );
  }

  return (
    <span
      title={`Mesh has ${fit.pooledVramGb.toFixed(1)} GB so far; needs ${fit.neededVramGb.toFixed(1)} GB to load.`}
    >
      <Badge tone="warn">Needs more capacity</Badge>
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
      <div className="mt-1.5 text-[11px] text-[var(--success)]">
        Will run on this Mac alone — {model.minVramGb} GB headroom available.
      </div>
    );
  }

  if (fit.kind === "pooled") {
    const contributors = fit.contributorCount;
    return (
      <div className="mt-1.5 text-[11px] text-[var(--info)]">
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
    <div className="mt-1.5 text-[11px] text-[var(--warn)]">
      Mesh has {fit.pooledVramGb.toFixed(1)} of {fit.neededVramGb.toFixed(1)} GB
      so far — needs {ask} more to load. Invite a friend or spin up another
      machine to unlock this model.
    </div>
  );
}

/**
 * "Run on the mesh" per-model toggle. Visible on the downloaded + startup
 * row so the user can opt the model into pooled-serve mode.
 *
 * Treat this as a black-box On/Off from the user's POV: implementation
 * details (pipeline-vs-expert split, the `force_split` config field, the
 * MoE experts-per-shard viability floor) are NOT surfaced here. If the
 * mesh can't currently serve the model in pooled mode, the toggle is
 * disabled with one short user-facing reason and that's it — no jargon,
 * no file paths, no protocol-level explanation.
 *
 * The disabled-with-reason path still uses the same internal heuristic
 * that previously rendered as a multi-line explainer (MoE expert count
 * vs proposed shards), but the user-visible text is just "Won't run on
 * this mesh yet". The detailed why-not lives in the runtime issue tracker
 * because it's a runtime limitation we expect to fix, not a permanent
 * user constraint.
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
  const expertCount = meshModel?.expertCount ?? null;
  const eligiblePeers = meshModel?.meshFit?.eligiblePeerCount ?? 1;
  const proposedShards = Math.max(2, eligiblePeers);
  const expertsPerShard =
    expertCount && proposedShards > 0 ? expertCount / proposedShards : null;
  const meshCannotServe =
    meshModel?.moe === true &&
    expertsPerShard !== null &&
    expertsPerShard < 64;

  const explainer = meshCannotServe
    ? "Won't run on this mesh yet — needs more contributors to split safely."
    : forceSplit
      ? "On — runs across the mesh whenever it's loaded."
      : "Off — runs solo when one machine can fit it.";

  const disabled = busy || meshCannotServe;

  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)]/60 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-[var(--fg)]">
          Run on the mesh
        </div>
        <div className="mt-0.5 max-w-md text-[11px] text-[var(--fg-muted)]">
          {explainer}
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
