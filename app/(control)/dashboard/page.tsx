"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { Setup } from "../../components/Setup";
import { type CatalogModel } from "../../lib/model-catalog";
import { useCatalog } from "../../lib/use-catalog";
import { useMeshStatus, type MeshModel, type NodeSummary } from "../../lib/use-mesh-status";
import { useMeshModels } from "../../lib/use-mesh-models";
import { nodeDisplayState } from "../../lib/node-display-state";
import { loadedModelUnderprovisioning } from "../../lib/mesh-fit";
import { LiveLaunchState } from "../../components/LiveLaunchState";

type ServiceState =
  | { state: "running"; pid: number | null }
  | { state: "stopped" }
  | { state: "unknown"; reason: string }
  | { state: "unavailable" };

type ControlStatus = {
  available: boolean;
  binPath: string | null;
  service: ServiceState;
  publicDeployment: boolean;
};

type RepairIssue = {
  kind:
    | "private-only-launchd"
    | "private-only-systemd"
    | "private-only-schtasks";
  message: string;
  unit: string;
  fixable: boolean;
};

type RepairResp = {
  ok: boolean;
  issues: RepairIssue[];
  applied?: Array<{ kind: RepairIssue["kind"]; ok: boolean; message: string }>;
};

type UpdateAsset = {
  kind: string;
  name: string;
  size: number;
  url: string;
};

type UpdateCheckResp =
  | {
      ok: true;
      currentVersion: string;
      latestVersion: string;
      updateAvailable: boolean;
      publishedAt: string;
      htmlUrl: string;
      asset: UpdateAsset | null;
      hostOs: string;
      hostArch: string;
    }
  | {
      ok: false;
      message: string;
      currentVersion: string;
    };

type UpdateDownloadResp =
  | { ok: true; path: string; opened: boolean; message: string }
  | { ok: false; message: string };

type StartupModel = { model: string; ctxSize?: number };
type StartupResp =
  | {
      ok: true;
      models: StartupModel[];
      configPath: string;
      restart?: { ok: boolean; message: string };
    }
  | { ok: false; message: string };

type LocalModel = { id: string; sizeBytes: number | null };
type ListResp =
  | { ok: true; models: LocalModel[] }
  | { ok: false; message: string; models: LocalModel[] };

type DownloadEvent =
  | { kind: "stdout" | "stderr"; text: string }
  | { kind: "progress"; percent: number; bytes: number; total: number }
  | { kind: "done"; ok: boolean; code: number }
  | { kind: "error"; message: string };

type QuickStartPhase =
  | { kind: "idle" }
  | {
      kind: "downloading";
      modelId: string;
      percent: number;
      bytes: number;
      total: number;
      lastLine: string;
    }
  | { kind: "loading"; modelId: string; message: string }
  | { kind: "done"; modelId: string }
  | { kind: "failed"; modelId: string; error: string };

const BACKEND_LABEL: Record<string, string> = {
  metal: "Apple Metal",
  cuda: "NVIDIA CUDA",
  rocm: "AMD ROCm",
  vulkan: "Vulkan",
  cpu: "CPU",
};

export default function DashboardPage() {
  const mesh = useMeshStatus();
  const meshModels = useMeshModels();
  const { catalog } = useCatalog();
  const [control, setControl] = useState<ControlStatus | null>(null);
  const [busy, setBusy] = useState<
    "start" | "stop" | "repair" | "quickstart" | "update" | null
  >(null);
  const [toast, setToast] = useState<string | null>(null);
  const [repair, setRepair] = useState<RepairResp | null>(null);
  const [startup, setStartup] = useState<StartupModel[] | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[] | null>(null);
  const [quickStart, setQuickStart] = useState<QuickStartPhase>({ kind: "idle" });
  const [update, setUpdate] = useState<UpdateCheckResp | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState<boolean>(false);
  // Track loaded models from the previous status poll so we can surface
  // a one-shot "Ready" card the moment a model transitions from
  // "configured but loading" to "actually serving".
  const [readyCardModelId, setReadyCardModelId] = useState<string | null>(null);
  const prevLoadedHere = useRef<string[]>([]);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track when we first entered the "loading" state so the timer in
  // ModelLoadingCard survives navigation away and back (remounting resets
  // useState but a ref on the parent persists for the page's lifetime).
  const loadingStartedAt = useRef<number | null>(null);
  // Guard so we only auto-trigger the quick-start download once per mount,
  // even if conditions momentarily flip back (e.g. during the startup
  // config refresh cycle).
  const autoStartFired = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/control/status", { cache: "no-store" });
      const data = (await res.json()) as ControlStatus;
      setControl(data);
    } catch {
      // transient — keep last good
    }
  }, []);

  // Cheap diagnostic poll — runs once at mount and after every repair
  // attempt. Doesn't piggyback on /api/control/status because we don't
  // want to read the launchd plist on every 4-second tick.
  const refreshRepair = useCallback(async () => {
    try {
      const res = await fetch("/api/control/repair", { cache: "no-store" });
      const data = (await res.json()) as RepairResp;
      setRepair(data);
    } catch {
      // controller off — banner just stays hidden
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
      // controller off — quick-start CTA just stays hidden
    }
  }, []);

  const refreshLocalModels = useCallback(async () => {
    try {
      const res = await fetch("/api/control/models/list", {
        cache: "no-store",
      });
      const data = (await res.json()) as ListResp;
      setLocalModels(data.models);
    } catch {
      // controller off — quick-start treats "unknown" as "none"
    }
  }, []);

  const refreshUpdate = useCallback(async () => {
    try {
      const res = await fetch("/api/control/update-check", {
        cache: "no-store",
      });
      const data = (await res.json()) as UpdateCheckResp;
      setUpdate(data);
    } catch {
      // network blip — banner just stays hidden
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshRepair();
    refreshStartup();
    refreshLocalModels();
    refreshUpdate();
    // Refresh control status every 4s (cheap), startup config + local
    // models every 12s (read disk on each call, less critical).
    // Update check is hourly — releases land at most once a day, and
    // the upstream API is rate-limited.
    refreshTimer.current = setInterval(() => {
      refresh();
    }, 4000);
    const slowTick = setInterval(() => {
      refreshStartup();
      refreshLocalModels();
    }, 12_000);
    const updateTick = setInterval(refreshUpdate, 60 * 60 * 1000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
      clearInterval(slowTick);
      clearInterval(updateTick);
    };
  }, [refresh, refreshRepair, refreshStartup, refreshLocalModels, refreshUpdate]);

  const runRepair = useCallback(async () => {
    setBusy("repair");
    setToast(null);
    try {
      const res = await fetch("/api/control/repair", { method: "POST" });
      const data = (await res.json()) as RepairResp;
      setRepair(data);
      const summary = (data.applied ?? [])
        .map((a) => a.message)
        .filter(Boolean)
        .join(" ");
      setToast(summary || "Repair complete.");
      await refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const act = useCallback(
    async (verb: "start" | "stop") => {
      setBusy(verb);
      setToast(null);
      try {
        const res = await fetch(`/api/control/${verb}`, { method: "POST" });
        const data = (await res.json()) as { ok: boolean; message: string };
        setToast(data.message);
        await refresh();
      } catch (e) {
        setToast(e instanceof Error ? e.message : "request failed");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  /**
   * One-click "download a sensible model + set it as the startup model
   * + bounce the runtime so it actually loads". This is the bit that's
   * been missing on the dashboard — sending users to /models to figure
   * out which 0.4–40 GB blob to pick is a terrible first-run UX. Here
   * we make that decision for them based on detected hardware.
   *
   * The download endpoint streams NDJSON; we render a real progress bar.
   * Once the file is on disk we POST to /api/control/models/startup,
   * which writes [[models]] in config.toml and bounces the autostart
   * unit so the runtime loads it. The poll loop above picks that up
   * within ~4–8 s and the card swaps for the loaded-model UI.
   */
  const runQuickStart = useCallback(
    async (choice: CatalogModel) => {
      setBusy("quickstart");
      setToast(null);
      setQuickStart({
        kind: "downloading",
        modelId: choice.id,
        percent: 0,
        bytes: 0,
        total: 0,
        lastLine: "starting…",
      });

      try {
        const dlRes = await fetch("/api/control/models/download", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: choice.id }),
        });
        if (!dlRes.ok || !dlRes.body) {
          let msg = `request returned ${dlRes.status}`;
          try {
            const err = (await dlRes.json()) as { message?: string };
            msg = err.message ?? msg;
          } catch {
            // body is the stream — already consumed
          }
          setQuickStart({ kind: "failed", modelId: choice.id, error: msg });
          setBusy(null);
          return;
        }

        const reader = dlRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let okFinal: boolean | null = null;
        let errMsg: string | null = null;
        // Tail the stream's stderr separately from generic last-line: when
        // the runtime CLI bails (e.g. "Expected an exact model ref…") the
        // useful sentence almost always lands on stderr right before exit,
        // and the dashboard previously threw it away in favour of a generic
        // "see Activity" hint that pointed at the wrong log file.
        let lastStderr: string | null = null;
        let lastAnyLine: string | null = null;

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
            if (ev.kind === "progress") {
              setQuickStart((q) =>
                q.kind === "downloading" && q.modelId === choice.id
                  ? {
                      ...q,
                      percent: ev.percent,
                      bytes: ev.bytes,
                      total: ev.total,
                    }
                  : q,
              );
            } else if (ev.kind === "stdout" || ev.kind === "stderr") {
              lastAnyLine = ev.text;
              if (ev.kind === "stderr") lastStderr = ev.text;
              setQuickStart((q) =>
                q.kind === "downloading" && q.modelId === choice.id
                  ? { ...q, lastLine: ev.text }
                  : q,
              );
            } else if (ev.kind === "done") {
              okFinal = ev.ok;
            } else if (ev.kind === "error") {
              errMsg = ev.message;
            }
          }
        }

        if (okFinal !== true) {
          setQuickStart({
            kind: "failed",
            modelId: choice.id,
            error:
              errMsg ??
              lastStderr ??
              lastAnyLine ??
              "Download didn't finish cleanly.",
          });
          setBusy(null);
          return;
        }

        setQuickStart({
          kind: "loading",
          modelId: choice.id,
          message: "Loading the model into the runtime…",
        });

        const startupRes = await fetch("/api/control/models/startup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: choice.id }),
        });
        const startupData = (await startupRes.json()) as StartupResp;

        if (startupData.ok) {
          setStartup(startupData.models);
          setQuickStart({ kind: "done", modelId: choice.id });
          setToast(
            startupData.restart?.message ??
              "Loaded. The runtime is restarting with this model.",
          );
        } else {
          setQuickStart({
            kind: "failed",
            modelId: choice.id,
            error: startupData.message,
          });
        }
        await Promise.all([refresh(), refreshLocalModels()]);
      } catch (e) {
        setQuickStart({
          kind: "failed",
          modelId: choice.id,
          error: e instanceof Error ? e.message : "request failed",
        });
      } finally {
        setBusy(null);
      }
    },
    [refresh, refreshLocalModels],
  );

  /**
   * Track which "update available" banner the user has explicitly
   * dismissed so we don't re-nag them every time they open the
   * dashboard. Keyed by the latest version we know about — when a
   * newer release ships, the banner reappears (which is what we want).
   *
   * Read once on mount so a stale `latestVersion` from earlier in the
   * session doesn't override a fresh dismiss.
   */
  useEffect(() => {
    if (!update || !update.ok || !update.updateAvailable) {
      setUpdateDismissed(false);
      return;
    }
    try {
      const stored = localStorage.getItem("closedmesh:update-dismissed");
      setUpdateDismissed(stored === update.latestVersion);
    } catch {
      setUpdateDismissed(false);
    }
  }, [update]);

  const dismissUpdate = useCallback(() => {
    if (!update || !update.ok) return;
    try {
      localStorage.setItem(
        "closedmesh:update-dismissed",
        update.latestVersion,
      );
    } catch {
      // private mode / quota exhausted — still hide for this session
    }
    setUpdateDismissed(true);
  }, [update]);

  const downloadUpdate = useCallback(async () => {
    if (!update || !update.ok || !update.asset) return;
    setBusy("update");
    setToast(null);
    try {
      const res = await fetch("/api/control/update-download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: update.asset.url,
          filename: update.asset.name,
        }),
      });
      const data = (await res.json()) as UpdateDownloadResp;
      setToast(data.message);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(null);
    }
  }, [update]);

  const selfNode = mesh.nodes.find((n) => n.isSelf) ?? null;
  const peers = mesh.nodes.filter((n) => !n.isSelf);
  const totalVram = mesh.nodes.reduce(
    (sum, n) => sum + (n.capability.vramGb || n.vramGb || 0),
    0,
  );
  // Mesh connectivity is the source of truth for "is this machine actually
  // running". `closedmesh service status` only knows about launchd-managed
  // processes — but the desktop app frequently spawns the runtime directly
  // (and on first install, before launchd is set up). If the runtime is
  // answering at :3131 and shows up in the mesh, it IS running, regardless
  // of what launchctl says. Otherwise the user gets a "Start sharing" button
  // even when sharing is already active, and clicking it can trigger
  // launchctl bootstrap → kill the running process.
  const meshConnected = selfNode !== null;
  const running = control?.service.state === "running" || meshConnected;
  const stopped = control?.service.state === "stopped" && !meshConnected;

  const selfVram = selfNode?.capability.vramGb ?? selfNode?.vramGb ?? 0;
  const selfBackend = selfNode?.capability.backend ?? "cpu";
  const loadedHere = selfNode?.capability.loadedModels ?? [];
  const startupConfigured = (startup ?? []).length > 0;

  // Detect "model just transitioned from not-loaded to loaded" and pop
  // the success card. Auto-clears after 12s — long enough to read,
  // short enough to not stick around forever once the user has seen it.
  useEffect(() => {
    const prev = prevLoadedHere.current;
    const newlyLoaded = loadedHere.find((m) => !prev.includes(m));
    prevLoadedHere.current = loadedHere;
    if (newlyLoaded && prev.length === 0) {
      setReadyCardModelId(newlyLoaded);
      const t = setTimeout(() => setReadyCardModelId(null), 12_000);
      return () => clearTimeout(t);
    }
  }, [loadedHere]);

  // Reset the loading-start timestamp once a model comes up so if the
  // runtime is bounced later the timer starts fresh.
  useEffect(() => {
    if (loadedHere.length > 0) loadingStartedAt.current = null;
  }, [loadedHere]);

  // Drop the "ready" success banner the instant the service goes away.
  // Otherwise a user who hits Stop sharing within 12s of a model coming
  // up sees a green "serving this model" card co-existing with the
  // "Not running" status above it — confusing on its own, and worse when
  // paired with a freshly-mounted ModelLoadingCard. Same for the
  // transient "unknown" state during a service bounce.
  useEffect(() => {
    if (!running) setReadyCardModelId(null);
  }, [running]);
  const localModelIds = new Set((localModels ?? []).map((m) => m.id));
  const recommendation = pickRecommendedModel(catalog, selfVram, selfBackend);

  // Auto-trigger the quick-start download on first launch. We wait until
  // both `startup` and `localModels` are non-null (i.e. the initial data
  // fetches have settled) before acting, so we don't fire during the brief
  // loading window where everything looks unconfigured. Once the download
  // begins the `autoStartFired` guard prevents re-triggering.
  useEffect(() => {
    if (autoStartFired.current) return;
    if (!recommendation) return;
    if (startup === null || localModels === null) return;
    if (startup.length > 0) return;
    if (localModels.length > 0) return;
    if (!control?.available || control.publicDeployment) return;
    autoStartFired.current = true;
    runQuickStart(recommendation);
  }, [control, startup, localModels, recommendation, runQuickStart]);

  const alreadyDownloaded = recommendation
    ? localModelIds.has(recommendation.id)
    : false;

  // Show the quick-start card whenever the runtime is reachable but
  // hasn't been told what to load yet. We deliberately don't gate on
  // `running` — if the service is stopped *and* unconfigured, getting
  // the user a model is the highest-leverage thing we can do; setting
  // a startup model bounces the runtime as a side effect, which lights
  // it up too. Skip when actively loading a model the user already
  // chose, when one is already serving, or during the explicit
  // "downloading" phase (the card itself takes over rendering).
  const showQuickStart =
    !!control &&
    control.available &&
    !control.publicDeployment &&
    loadedHere.length === 0 &&
    !startupConfigured &&
    !!recommendation;

  if (control?.publicDeployment && !mesh.online && !mesh.loading) {
    return <PublicNoMesh />;
  }
  if (control && !control.available && !control.publicDeployment) {
    return <Setup onInstalled={refresh} />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader
        title="Dashboard"
        subtitle="Your machine, the mesh, and the models you're running."
      />

      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
          {update &&
            update.ok &&
            update.updateAvailable &&
            !updateDismissed && (
              <UpdateBanner
                check={update}
                busy={busy === "update"}
                onDownload={downloadUpdate}
                onDismiss={dismissUpdate}
              />
            )}

          {repair && repair.issues.length > 0 && (
            <RepairBanner
              issues={repair.issues}
              busy={busy === "repair"}
              onRepair={runRepair}
            />
          )}

          <ThisNodeCard
            self={selfNode}
            running={running}
            stopped={stopped}
            startupConfigured={startupConfigured}
            busy={busy}
            meshModels={meshModels.models}
            startupIds={new Set((startup ?? []).map((s) => s.model))}
            onStart={() => act("start")}
            onStop={() => act("stop")}
          />

          {showQuickStart && recommendation && (
            <QuickStartCard
              choice={recommendation}
              alreadyDownloaded={alreadyDownloaded}
              phase={quickStart}
              busy={busy === "quickstart"}
              onStart={() => runQuickStart(recommendation)}
            />
          )}

          {!showQuickStart &&
            running &&
            startupConfigured &&
            loadedHere.length === 0 && (
              <ModelLoadingCard
                startupModelId={startup?.[0]?.model ?? "unknown"}
                startedAt={(() => {
                  if (loadingStartedAt.current === null)
                    loadingStartedAt.current = Date.now();
                  return loadingStartedAt.current;
                })()}
                meshModel={
                  meshModels.models.find(
                    (m) => m.name === (startup?.[0]?.model ?? ""),
                  ) ?? null
                }
                selfHostname={selfNode?.hostname ?? null}
              />
            )}

          {readyCardModelId && (
            <ModelReadyCard
              modelId={readyCardModelId}
              underprovisioning={loadedModelUnderprovisioning(
                meshModels.models.find((m) => m.name === readyCardModelId) ??
                  null,
              )}
              onDismiss={() => setReadyCardModelId(null)}
            />
          )}

          {selfNode && <ContributionCard self={selfNode} />}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SummaryStat
              label="Contributors"
              value={mesh.online ? String(mesh.nodeCount) : "0"}
              hint={
                peers.length > 0
                  ? `${peers.length} teammate${peers.length === 1 ? "" : "s"} sharing capacity`
                  : "you're the only one — share the app to grow the mesh"
              }
              href="/nodes"
            />
            <SummaryStat
              label="Pooled memory"
              value={totalVram > 0 ? `${totalVram.toFixed(1)} GB` : "—"}
              hint="combined across every contributor"
              href="/nodes"
            />
            <SummaryStat
              label="Models loaded"
              value={String(mesh.models.length)}
              hint={
                mesh.models[0] ? mesh.models[0] : "no models loaded yet"
              }
              href="/models"
            />
          </div>

          <QuickActions
            running={running}
            busy={busy}
            toast={toast}
          />

          {peers.length > 0 && <PeersPreview peers={peers} />}
        </div>
      </main>
    </div>
  );
}

function UpdateBanner({
  check,
  busy,
  onDownload,
  onDismiss,
}: {
  check: Extract<UpdateCheckResp, { ok: true }>;
  busy: boolean;
  onDownload: () => void;
  onDismiss: () => void;
}) {
  const sizeLabel = check.asset
    ? `${(check.asset.size / 1024 / 1024).toFixed(0)} MB`
    : null;
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 100% at 0% 0%, rgba(255,122,69,0.16), transparent 70%)",
        }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
            Update available
          </div>
          <div className="mt-0.5 text-base font-semibold tracking-tight text-[var(--fg)]">
            ClosedMesh {check.latestVersion}
            <span className="ml-2 font-mono text-[11px] font-normal text-[var(--fg-muted)]">
              you&apos;re on {check.currentVersion}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">
            {check.asset
              ? "We'll download the installer and open it for you. You'll click through the usual " +
                (check.hostOs === "macos"
                  ? "drag-to-Applications"
                  : check.hostOs === "windows"
                    ? "Windows installer"
                    : "AppImage") +
                " step to finish."
              : "No installer published for this platform yet — open the release page on GitHub to grab one manually."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {check.asset ? (
            <button
              onClick={onDownload}
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-black shadow-[0_8px_24px_-12px_rgba(255,122,69,0.7)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy
                ? "Downloading…"
                : `Download${sizeLabel ? ` · ${sizeLabel}` : ""}`}
            </button>
          ) : (
            <a
              href={check.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-black shadow-[0_8px_24px_-12px_rgba(255,122,69,0.7)] transition hover:brightness-110"
            >
              Open release page
            </a>
          )}
          <a
            href={check.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2 text-xs font-medium text-[var(--fg-muted)] transition hover:text-[var(--fg)]"
          >
            Notes
          </a>
          <button
            onClick={onDismiss}
            className="rounded-lg px-2 py-2 text-xs text-[var(--fg-muted)] transition hover:text-[var(--fg)]"
            title="Hide this banner until the next release"
          >
            Later
          </button>
        </div>
      </div>
    </section>
  );
}

function RepairBanner({
  issues,
  busy,
  onRepair,
}: {
  issues: RepairIssue[];
  busy: boolean;
  onRepair: () => void;
}) {
  const fixable = issues.some((i) => i.fixable);
  return (
    <section className="rounded-2xl border border-amber-400/40 bg-amber-400/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <div className="text-[10px] uppercase tracking-[0.16em] text-amber-300">
            Heads-up — autostart needs a fix
          </div>
          <ul className="mt-1.5 space-y-1.5 text-sm text-[var(--fg)]">
            {issues.map((i) => (
              <li key={i.kind}>
                <span>{i.message}</span>
                <span className="ml-1 font-mono text-[11px] text-[var(--fg-muted)]">
                  ({i.unit})
                </span>
              </li>
            ))}
          </ul>
        </div>
        {fixable && (
          <button
            onClick={onRepair}
            disabled={busy}
            className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Repairing…" : "Repair now"}
          </button>
        )}
      </div>
    </section>
  );
}

function ThisNodeCard({
  self,
  running,
  stopped,
  startupConfigured,
  busy,
  meshModels,
  startupIds,
  onStart,
  onStop,
}: {
  self: NodeSummary | null;
  running: boolean;
  stopped: boolean;
  startupConfigured: boolean;
  busy:
    | "start"
    | "stop"
    | "repair"
    | "quickstart"
    | "update"
    | null;
  meshModels: MeshModel[];
  startupIds: Set<string>;
  onStart: () => void;
  onStop: () => void;
}) {
  const cap = self?.capability;
  const backend = cap ? BACKEND_LABEL[cap.backend] ?? cap.backend : null;
  const vram = cap?.vramGb ?? self?.vramGb ?? 0;
  const loaded = cap?.loadedModels ?? [];

  // Look up the live planner snapshot for each loaded model so we can
  // render solo/split/moe/mmap-fallback under the model name. The runtime
  // sometimes reports a model with a `-Q4_K_M` suffix variation across
  // /api/models vs /v1/models, so accept partial overlap.
  const findMeshModel = (id: string): MeshModel | null => {
    const exact = meshModels.find((m) => m.name === id);
    if (exact) return exact;
    return (
      meshModels.find((m) => m.name.includes(id) || id.includes(m.name)) ??
      null
    );
  };

  // Status text and dot color come from the shared node-display-state helper
  // so this card, the /nodes mesh table, and the public status page can never
  // disagree about whether the same node is Ready / Idle / Offline.
  const display = nodeDisplayState(self, running);

  // Detect "loaded but underprovisioned" — the runtime says hosted_models
  // includes this model, but the planner classified it as cold/mmap-fallback
  // because the host is too small to fit it in VRAM. llama-server WILL
  // accept requests in that state and then time out trying to page weights
  // from disk; from the user's POV the dashboard says "Ready · serving"
  // while every chat fails. Override the green Ready treatment with an
  // amber warning that names the exact shortfall. See app/lib/mesh-fit.ts.
  const loadedMeshModels = loaded.map((id) => findMeshModel(id));
  const underprovisioned = loadedMeshModels
    .map((m) => loadedModelUnderprovisioning(m))
    .find((u) => u !== null);
  const isUnderprovisioned = underprovisioned !== undefined;

  // When the runtime has committed to load the startup model but
  // llama-server hasn't finished yet, `nodeDisplayState` now returns
  // "Loading" with a verbose troubleshooting description aimed at
  // stuck-loading nodes on the public status page. For first-boot users
  // on this machine that copy is alarming, so swap in a calmer line
  // when we know we're just waiting for the configured startup model.
  const statusText = !running
    ? stopped
      ? "Not running. Start to share this machine."
      : "Checking status…"
    : isUnderprovisioned && underprovisioned
      ? `${primaryLoadedDisplayName(loadedMeshModels, loaded)} needs about ${underprovisioned.needGb.toFixed(0)} GB of pooled memory to serve. This machine offers ${underprovisioned.haveGb.toFixed(0)} GB on its own — connect another peer to bring it online.`
      : startupConfigured && display.label === "Loading"
        ? "Loading the startup model — this can take a minute on first boot, longer for larger models."
        : display.description;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,122,69,0.18), transparent 70%)",
        }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="flex items-start gap-3.5">
          <span
            className={
              "mt-1 inline-block h-3 w-3 rounded-full " +
              (!running
                ? stopped
                  ? "bg-zinc-500"
                  : "bg-amber-400"
                : isUnderprovisioned
                  ? "bg-amber-400"
                  : `${display.dot} ${display.label === "Ready" || display.label === "Serving" ? "shadow-[0_0_14px_rgba(52,211,153,0.7)]" : ""}`)
            }
          />
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
              This machine
            </div>
            <div className="mt-0.5 text-xl font-semibold tracking-tight">
              {self?.hostname ?? "Your computer"}
            </div>
            <div className="mt-1 text-[12px] text-[var(--fg-muted)]">
              {statusText}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {running ? (
            <button
              disabled={busy !== null}
              onClick={onStop}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-4 py-2 text-sm font-medium text-[var(--fg)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "stop" ? "Stopping…" : "Stop sharing"}
            </button>
          ) : (
            <button
              disabled={busy !== null || running}
              onClick={onStart}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black shadow-[0_8px_24px_-12px_rgba(255,122,69,0.7)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "start" ? "Starting…" : "Start sharing"}
            </button>
          )}
        </div>
      </div>

      <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Hardware" value={backend ?? "—"} accent={!!backend} />
        <Stat
          label="Memory"
          value={vram ? `${vram.toFixed(1)} GB` : "—"}
        />
        <Stat
          label="Models loaded"
          value={loaded.length > 0 ? String(loaded.length) : "0"}
        />
      </div>

      {loaded.length > 0 && (
        <div className="relative mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">
            Currently loaded
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {loaded.map((m) => (
              <li
                key={m}
                className="flex flex-wrap items-center gap-x-2 gap-y-1"
              >
                <span className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]">
                  {m}
                </span>
                <LiveLaunchState
                  meshModel={findMeshModel(m)}
                  isLoaded
                  isConfigured={startupIds.has(m)}
                  selfHostname={self?.hostname ?? null}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 transition hover:border-[var(--accent)]/40 hover:bg-[var(--bg-elev-2)]"
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-[var(--fg)]">
        {value}
      </div>
      <div className="mt-1 truncate text-[11px] text-[var(--fg-muted)] group-hover:text-[var(--fg)]">
        {hint}
      </div>
    </Link>
  );
}

/**
 * Pick a "first model" recommendation given the local node's reported
 * capacity. We bias toward something that'll actually run on the user's
 * hardware (no pointing a CPU-only laptop at a 72B model) while still
 * picking something useful enough that the chat feels real.
 *
 *   - 8 GB of VRAM/UMA + a real GPU backend → Qwen 3 8B (the demo model)
 *   - 4–8 GB or CPU-only on a fast machine → Phi-3 mini (cpuOk, 2.5 GB)
 *   - tiny / unknown → Qwen 3 0.6B smoke-test (cpuOk, 0.4 GB)
 *
 * Returns null only if the catalog is empty (shouldn't happen).
 */
function pickRecommendedModel(
  catalog: CatalogModel[],
  vramGb: number,
  backend: string,
): CatalogModel | null {
  const hasGpu = backend !== "cpu" && backend !== "" && backend !== "unknown";
  const candidates = catalog.filter((m) => {
    if (vramGb >= m.minVramGb) return true;
    return m.cpuOk === true && vramGb === 0;
  });
  if (candidates.length === 0) return catalog[0] ?? null;

  const eightB = candidates.find((m) => m.id === "Qwen3-8B-Q4_K_M");
  if (eightB && vramGb >= eightB.minVramGb && hasGpu) return eightB;

  const phi = candidates.find((m) => m.id === "Phi-3-mini-4k-Q4_K_M");
  if (phi && vramGb >= phi.minVramGb) return phi;

  const smokeTest = catalog.find((m) => m.id === "Qwen3-0.6B-Q4_K_M");
  return smokeTest ?? candidates[0] ?? null;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function QuickStartCard({
  choice,
  alreadyDownloaded,
  phase,
  busy,
  onStart,
}: {
  choice: CatalogModel;
  alreadyDownloaded: boolean;
  phase: QuickStartPhase;
  busy: boolean;
  onStart: () => void;
}) {
  const isDownloading = phase.kind === "downloading";
  const isLoading = phase.kind === "loading";
  const failed = phase.kind === "failed";
  const showProgress = isDownloading || isLoading;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--accent)]/40 bg-[var(--bg-elev)] p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 -bottom-20 h-64 w-64 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,122,69,0.18), transparent 70%)",
        }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 max-w-2xl">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
            Quick start
          </div>
          <div className="mt-0.5 text-xl font-semibold tracking-tight">
            Load {choice.name} and start chatting
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--fg-muted)]">
            {choice.description}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--fg-muted)]">
            <span className="rounded-full border border-[var(--border)] bg-[var(--bg-elev-2)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg)]">
              {choice.id}
            </span>
            <span>~{choice.sizeGb.toFixed(1)} GB download</span>
            <span aria-hidden>·</span>
            <span>needs ≥ {choice.minVramGb} GB memory</span>
            {alreadyDownloaded && !showProgress && (
              <>
                <span aria-hidden>·</span>
                <span className="text-emerald-300">
                  already downloaded — will load instantly
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            onClick={onStart}
            disabled={busy || showProgress}
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-black shadow-[0_8px_24px_-12px_rgba(255,122,69,0.7)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase.kind === "downloading"
              ? `Downloading… ${phase.percent.toFixed(0)}%`
              : phase.kind === "loading"
                ? "Loading…"
                : alreadyDownloaded
                  ? "Load and start chatting"
                  : "Download and start chatting"}
          </button>
          <Link
            href="/models"
            className="text-[11px] text-[var(--fg-muted)] hover:text-[var(--accent)]"
          >
            Pick a different model →
          </Link>
        </div>
      </div>

      {phase.kind === "downloading" && (
        <div className="relative mt-5">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-elev-2)]">
            <div
              className="h-full bg-[var(--accent)] transition-[width] duration-300"
              style={{ width: `${Math.max(2, phase.percent)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--fg-muted)]">
            <span className="truncate font-mono">{phase.lastLine}</span>
            <span className="shrink-0 tabular-nums">
              {phase.total > 0
                ? `${formatBytes(phase.bytes)} / ${formatBytes(phase.total)}`
                : ""}
            </span>
          </div>
        </div>
      )}

      {phase.kind === "loading" && (
        <div className="relative mt-5 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2.5 text-xs text-[var(--fg-muted)]">
          {phase.message}
        </div>
      )}

      {failed && (
        <div className="relative mt-5 rounded-lg border border-rose-400/40 bg-rose-400/5 px-3 py-2.5 text-xs text-rose-200">
          <div className="font-medium text-rose-100">Download failed</div>
          <div className="mt-1 break-words font-mono text-[11px] text-rose-200/90">
            {phase.error}
          </div>
          <div className="mt-1 text-[11px] text-rose-200/70">
            Try again, or pick a different model below.
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Loading-state card shown between "user picked a model" and "runtime is
 * actually serving it". Starts a local timer the moment we render so
 * the user has *some* feedback that we're not just frozen — the worst
 * UX failure here is staring at "Running, but no model loaded yet" for
 * 90 seconds with nothing changing on the page.
 *
 * Copy progresses with elapsed time so a 2-minute load on a heavy 8B
 * model doesn't look identical to a 5-second load on a 0.4B smoke test.
 */
function ModelLoadingCard({
  startupModelId,
  startedAt,
  meshModel,
  selfHostname,
}: {
  startupModelId: string;
  startedAt: number;
  /** Live planner snapshot. When the runtime is in `WaitingForCapacity`
   * the time-based phase text below is a lie — nothing's actually loading,
   * the planner is parked waiting for peers. We override the phase copy
   * with the real reason in that case. */
  meshModel: MeshModel | null;
  selfHostname: string | null;
}) {
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - startedAt) / 1000),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [startedAt]);

  // The runtime publishes per-model `mesh_fit` even before the model
  // actually loads. If the pool can't fit it (`fitsOnLargestNode` and
  // `fitsPooled` both false) the planner is in WaitingForCapacity and
  // will never make progress on its own — surface that instead of the
  // "loading…" lie. We give the runtime ~10 s to publish the fit data
  // before trusting it (a fresh /api/models call after a bounce can come
  // back with stale or empty data on the first poll).
  const fit = meshModel?.meshFit ?? null;
  const planner =
    elapsed >= 5 && fit && !fit.fitsOnLargestNode && !fit.fitsPooled
      ? "waiting_for_capacity"
      : meshModel && (meshModel.splitKind === "pipeline" || meshModel.splitKind === "moe")
        ? "loading_split"
        : "loading_solo";

  let phaseLabel: string;
  let hint: string;
  if (planner === "waiting_for_capacity" && fit) {
    const shortfall = Math.max(0, fit.neededVramGb - fit.pooledVramGb);
    const here = selfHostname ?? "this machine";
    phaseLabel = `Waiting for capacity — need ${shortfall.toFixed(0)} GB more pooled VRAM`;
    hint =
      fit.eligiblePeerCount <= 1
        ? `Pooled ${fit.pooledVramGb.toFixed(1)} of ${fit.neededVramGb.toFixed(1)} GB so far (only ${here} contributing). Invite a friend or spin up another machine on this mesh — the runtime will load the model the moment pooled capacity crosses the threshold.`
        : `Pooled ${fit.pooledVramGb.toFixed(1)} of ${fit.neededVramGb.toFixed(1)} GB across ${fit.eligiblePeerCount} peers. Add another contributor to cross the threshold.`;
  } else if (elapsed < 8) {
    phaseLabel = "Restarting the runtime…";
    hint = "Bouncing the launchd unit so it picks up the new config.";
  } else if (elapsed < 30) {
    phaseLabel = "Reading model weights from disk…";
    hint = "Mapping the GGUF file. Bigger models take a moment.";
  } else if (elapsed < 75) {
    phaseLabel = "Loading into memory…";
    hint = "Almost done. The runtime registers with the mesh once weights are in.";
  } else if (elapsed < 150) {
    phaseLabel = "Larger models can take a couple of minutes…";
    hint = "Cold loads off a slow SSD or with high context size run long.";
  } else {
    phaseLabel = "This is taking longer than usual.";
    hint =
      "Something might be wrong. Open Activity for the runtime log, or stop & try a smaller model.";
  }

  // "Stuck" styling when we genuinely look stuck (>2.5min) OR when the
  // planner is parked waiting for capacity — both cases need the user to
  // take action rather than just wait.
  const stuck = elapsed >= 150 || planner === "waiting_for_capacity";

  return (
    <section
      className={
        "relative overflow-hidden rounded-2xl border p-5 " +
        (stuck
          ? "border-amber-400/40 bg-amber-400/5"
          : "border-[var(--accent)]/30 bg-[var(--bg-elev)]")
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: stuck
            ? "radial-gradient(60% 100% at 0% 0%, rgba(251,191,36,0.10), transparent 70%)"
            : "radial-gradient(60% 100% at 0% 0%, rgba(255,122,69,0.10), transparent 70%)",
        }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 max-w-2xl items-start gap-3">
          <span
            aria-hidden
            className={
              "mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full " +
              (stuck
                ? "bg-amber-300"
                : "bg-[var(--accent)] shadow-[0_0_14px_rgba(255,122,69,0.7)]")
            }
          >
            {!stuck && (
              <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-[var(--accent)]/50" />
            )}
          </span>
          <div className="min-w-0">
            <div
              className={
                "text-[10px] uppercase tracking-[0.18em] " +
                (stuck ? "text-amber-300" : "text-[var(--accent)]")
              }
            >
              Loading model · {formatElapsed(elapsed)}
            </div>
            <div className="mt-0.5 truncate font-mono text-sm text-[var(--fg)]">
              {startupModelId}
            </div>
            <div className="mt-1 text-[13px] text-[var(--fg)]">
              {phaseLabel}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
              {hint}
            </div>
          </div>
        </div>
        <Link
          href="/logs"
          className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2 text-[11px] font-medium text-[var(--fg-muted)] transition hover:text-[var(--fg)]"
        >
          Open Activity →
        </Link>
      </div>
    </section>
  );
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

/**
 * Best human-readable name for the first loaded model. Prefers the
 * runtime's `displayName` (catalog ref → "Mixtral 8x7B Instruct"),
 * falls back to the raw id when the planner hasn't surfaced the model
 * yet — both cases are common during the first few seconds after
 * llama-server flips ready.
 */
function primaryLoadedDisplayName(
  meshModels: ReadonlyArray<MeshModel | null>,
  loadedIds: ReadonlyArray<string>,
): string {
  const first = meshModels.find((m) => m !== null);
  if (first?.displayName) return first.displayName;
  return loadedIds[0] ?? "This model";
}

/**
 * Small "your model just came up" success card. Shown briefly after a
 * Quick start completes and the polled status confirms the runtime is
 * actually serving the model. The card is auto-dismissed via state in
 * the parent — this component just renders it.
 */
function ModelReadyCard({
  modelId,
  underprovisioning,
  onDismiss,
}: {
  modelId: string;
  /** Non-null when the runtime accepted the model into hosted_models but
   * the planner classifies it as cold/mmap-fallback. We still pop a card
   * (because llama_ready DID flip and the user just spent 30 s staring
   * at a loading spinner — they deserve confirmation that something
   * happened) but we recolor it amber and tell the truth: the model is
   * loaded, but won't actually serve solo, and chat will hang until a
   * peer joins. */
  underprovisioning: ReturnType<typeof loadedModelUnderprovisioning>;
  onDismiss: () => void;
}) {
  const danger = underprovisioning !== null;
  return (
    <section
      className={
        "relative overflow-hidden rounded-2xl border p-5 " +
        (danger
          ? "border-amber-400/50 bg-amber-400/5"
          : "border-emerald-400/40 bg-emerald-400/5")
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: danger
            ? "radial-gradient(60% 100% at 0% 0%, rgba(251,191,36,0.10), transparent 70%)"
            : "radial-gradient(60% 100% at 0% 0%, rgba(52,211,153,0.10), transparent 70%)",
        }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 max-w-2xl items-start gap-3">
          <span
            aria-hidden
            className={
              "mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full " +
              (danger
                ? "bg-amber-400"
                : "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.7)]")
            }
          />
          <div className="min-w-0">
            <div
              className={
                "text-[10px] uppercase tracking-[0.18em] " +
                (danger ? "text-amber-300" : "text-emerald-300")
              }
            >
              {danger ? "Awaiting capacity" : "Ready"}
            </div>
            <div className="mt-0.5 truncate font-mono text-sm text-[var(--fg)]">
              {modelId}
            </div>
            <div className="mt-1 text-[12px] text-[var(--fg-muted)]">
              {danger
                ? `This model needs about ${underprovisioning.needGb.toFixed(0)} GB of pooled memory to serve. Your machine offers ${underprovisioning.haveGb.toFixed(0)} GB on its own — connect another peer to bring it online.`
                : "The runtime is serving this model. You're sharing with the mesh."}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {danger ? (
            <Link
              href="/nodes"
              className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-black transition hover:brightness-110"
            >
              Add a peer
            </Link>
          ) : (
            <Link
              href="/chat"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-black shadow-[0_8px_24px_-12px_rgba(255,122,69,0.7)] transition hover:brightness-110"
            >
              Open chat
            </Link>
          )}
          <button
            onClick={onDismiss}
            className="rounded-lg px-2 py-2 text-xs text-[var(--fg-muted)] transition hover:text-[var(--fg)]"
            title="Hide this card"
          >
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}

function QuickActions({
  running,
  busy,
  toast,
}: {
  running: boolean;
  busy:
    | "start"
    | "stop"
    | "repair"
    | "quickstart"
    | "update"
    | null;
  toast: string | null;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">
        What now?
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ActionLink href="/chat">Open chat</ActionLink>
        <ActionLink href="/models">Browse models</ActionLink>
        <ActionLink href="/nodes">Add a remote machine</ActionLink>
      </div>
      {toast && (
        <div className="mt-3 whitespace-pre-line rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2 text-xs text-[var(--fg-muted)]">
          {toast}
        </div>
      )}
    </section>
  );
}

function ActionButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2.5 text-xs font-medium text-[var(--fg)] transition hover:border-[var(--accent)]/40 hover:bg-[var(--bg-elev)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ActionLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2.5 text-center text-xs font-medium text-[var(--fg)] transition hover:border-[var(--accent)]/40 hover:bg-[var(--bg-elev)]"
    >
      {children}
    </Link>
  );
}

function PeersPreview({ peers }: { peers: NodeSummary[] }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">
          Sharing with
        </div>
        <Link
          href="/nodes"
          className="text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
        >
          View all →
        </Link>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {peers.slice(0, 4).map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-[var(--fg)]">
                {p.hostname ?? p.id.slice(0, 12)}
              </div>
              <div className="text-[11px] text-[var(--fg-muted)]">
                {(BACKEND_LABEL[p.capability.backend] ?? p.capability.backend) +
                  " · " +
                  (p.capability.vramGb || p.vramGb).toFixed(1) +
                  " GB"}
              </div>
            </div>
            <span
              className={
                "rounded-full border px-2 py-0.5 text-[10px] font-medium " +
                (p.state === "serving"
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "border-zinc-400/40 bg-zinc-400/10 text-zinc-300")
              }
            >
              {p.state === "serving" ? "Serving" : p.role}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">
        {label}
      </div>
      <div
        className={
          "mt-0.5 truncate text-sm font-medium " +
          (accent ? "text-[var(--accent)]" : "text-[var(--fg)]")
        }
      >
        {value}
      </div>
    </div>
  );
}

/**
 * "What you're holding right now" card. Shown when the local node is
 * actively contributing to a multi-node serve — pipeline-host, layer
 * worker, or MoE shard. Reads `splitRole` / `splitGroup` / `moeShard`
 * from the runtime's self-fields (`my_split_role` etc.) so the dashboard
 * can name the contribution concretely instead of saying "your machine
 * is connected to the mesh".
 *
 * Renders `null` when the self-node has no split role: that includes
 * solo serves, standby states, and older runtimes that don't emit the
 * fields. Better to show nothing than to muddy the dashboard with a
 * "contributing layers ?-? of model ?" placeholder.
 */
function ContributionCard({ self }: { self: NodeSummary }) {
  if (!self.splitRole) return null;

  let title: string;
  let body: string;
  let model: string;

  if (self.splitRole === "pipeline_host" && self.splitGroup) {
    const peerCount = Math.max(0, self.splitGroup.peerIds.length - 1);
    model = self.splitGroup.model;
    title = "You're hosting a pipeline split";
    body = peerCount > 0
      ? `Your machine coordinates the elected host for ${model}, with ${peerCount} layer worker${peerCount === 1 ? "" : "s"} pooling ${self.splitGroup.totalGroupVramGb.toFixed(1)} GB of memory across the mesh.`
      : `Your machine is the elected host for ${model}, ready to fan layers out as workers join (${self.splitGroup.totalGroupVramGb.toFixed(1)} GB pooled so far).`;
  } else if (self.splitRole === "pipeline_worker" && self.splitGroup) {
    model = self.splitGroup.model;
    title = "You're holding part of the model";
    body = `Your machine is running a slice of ${model} as a layer worker — the elected host pulls forward passes from your VRAM as part of a ${self.splitGroup.totalGroupVramGb.toFixed(1)} GB pooled split.`;
  } else if (self.splitRole === "moe_shard" && self.moeShard) {
    model = self.moeShard.model;
    title = "You're running an expert shard";
    body = self.moeShard.totalShards > 1
      ? `Your machine holds one of ${self.moeShard.totalShards} MoE shards for ${model}. Each contributor handles a subset of the experts; your VRAM is unlocking experts the swarm couldn't otherwise serve.`
      : `Your machine is running ${model} as an expert shard, ready to pair with peers as they join.`;
  } else {
    return null;
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-emerald-400/40 bg-emerald-400/5 p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 100% at 100% 0%, rgba(52,211,153,0.10), transparent 70%)",
        }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 max-w-2xl items-start gap-3">
          <span
            aria-hidden
            className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.7)]"
          />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">
              Your contribution
            </div>
            <div className="mt-0.5 text-base font-semibold tracking-tight text-[var(--fg)]">
              {title}
            </div>
            <div className="mt-1 max-w-xl text-[12px] leading-relaxed text-[var(--fg-muted)]">
              {body}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--fg-muted)]">
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-mono text-emerald-200">
                {model}
              </span>
              <span aria-hidden>·</span>
              <span className="font-mono uppercase tracking-wider">
                {self.splitRole.replace("_", " ")}
              </span>
            </div>
          </div>
        </div>
        <Link
          href="/nodes"
          className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2 text-[11px] font-medium text-[var(--fg-muted)] transition hover:text-[var(--fg)]"
        >
          See the topology →
        </Link>
      </div>
    </section>
  );
}

function PublicNoMesh() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[var(--bg)] p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% -10%, rgba(255,122,69,0.18), transparent 70%)",
        }}
      />
      <div className="relative max-w-lg text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight">
          You don&apos;t have a mesh yet.
        </h1>
        <p className="mt-3 text-pretty text-sm text-[var(--fg-muted)]">
          ClosedMesh runs on machines you own. Install the desktop app and
          this dashboard lights up — chat, mesh, models, all in one place.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/download"
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-black shadow-[0_8px_24px_-12px_rgba(255,122,69,0.7)]"
          >
            Download
          </Link>
          <Link
            href="/about"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-5 py-2.5 text-sm font-medium text-[var(--fg)] hover:bg-[var(--bg-elev-2)]"
          >
            How it works
          </Link>
        </div>
      </div>
    </div>
  );
}
