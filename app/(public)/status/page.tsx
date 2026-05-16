"use client";

import { useEffect, useRef, useState } from "react";
import { PublicHeader } from "../../components/PublicHeader";
import { MeshLiveStatus } from "../../components/MeshLiveStatus";
import { nodeDisplayState } from "../../lib/node-display-state";
import { MODEL_CATALOG, type CatalogModel } from "../../lib/model-catalog";
import { normalizeModelId } from "../../lib/model-id";
import type { NodeSummary } from "../../lib/use-mesh-status";

type MeshNode = NodeSummary;

type MeshStatus = {
  online: boolean;
  nodeCount: number;
  models: string[];
  nodes: MeshNode[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prettyHostname(raw: string | null): string {
  if (!raw) return "Unknown node";
  // Strip common suffixes like .local, .internal, ip-xxx-xxx-xxx-xxx
  if (raw.startsWith("ip-")) return "Entry node";
  return raw.replace(/\.local$/, "").replace(/\.internal$/, "");
}

function prettyModelName(id: string): string {
  return id
    .replace(/\.gguf$/i, "")
    .replace(/-Q\d+(_K(_[SM])?|_0|_1)?$/i, "")
    .replace(/-UD-Q\d+(_K(_[SM]|_XL))?$/i, "");
}

function backendLabel(backend: string, _vendor: string): string {
  const map: Record<string, string> = {
    metal: "Apple Metal",
    cuda: "NVIDIA CUDA",
    rocm: "AMD ROCm",
    vulkan: "Vulkan",
    cpu: "CPU",
  };
  return map[backend] ?? backend;
}

/**
 * Try to match a runtime-reported model id against our hand-maintained
 * catalog. The runtime stores models under the resolved Hugging Face
 * filename stem (e.g. `Mixtral-8x7B-Instruct-v0.1.q5_k_m`) while the
 * catalog uses our canonical refs (`Mixtral-8x7B-Instruct-v0.1-Q5_K_M`),
 * so go through the same normalization we use everywhere else for
 * matching. Returns null for orphan / custom models — those we just
 * can't make any fit claim about, since we have no minVramGb.
 */
function lookupCatalogModel(id: string): CatalogModel | null {
  const target = normalizeModelId(id);
  return MODEL_CATALOG.find((m) => normalizeModelId(m.id) === target) ?? null;
}

/**
 * What is this node trying to load, and is it actually going to fit?
 *
 * Returns `null` if the node isn't trying to load anything. Otherwise
 * returns the first servingModels entry plus a fit verdict: if we can
 * map it to a catalog entry we compute the shortfall against the host's
 * usable VRAM, and otherwise we say "unknown" so the UI can render
 * "Loading X" without making a false fit claim.
 *
 * Why a single model rather than the whole list: stuck-loading hosts
 * almost always have just one entry in `servingModels` — it's the
 * startup-config model the runtime is trying to bring up. If we ever
 * see multiple, picking the first one is a reasonable default; the
 * card layout doesn't need to fan out.
 */
type WarmingVerdict =
  | { kind: "fits"; modelId: string; displayName: string; catalog: CatalogModel; hostVramGb: number }
  | {
      kind: "pooling";
      modelId: string;
      displayName: string;
      catalog: CatalogModel;
      peerCount: number;
      pooledGb: number;
      neededGb: number;
      /**
       * How many peers in the mesh have actually committed to hosting
       * this model right now (i.e. their `hosted_models` includes it).
       * When this is 0 with `peerCount >= 2`, the mesh has the
       * capacity to serve but no peer has been elected as host yet —
       * the symptom that masquerades as "loading forever" on the
       * public page and was the actual root cause of the 5-machine
       * stall, not a memory shortfall.
       */
      hostingCount: number;
    }
  | {
      kind: "underprovisioned";
      modelId: string;
      displayName: string;
      catalog: CatalogModel;
      hostVramGb: number;
      shortfallGb: number;
    }
  | { kind: "unknown"; modelId: string; displayName: string };

function warmingUpVerdict(
  node: NodeSummary,
  warmingPeerCountForModel = 1,
  pooledGbForModel = 0,
  hostingCountForModel = 0,
): WarmingVerdict | null {
  const modelId = node.servingModels[0];
  if (!modelId) return null;
  const display = prettyModelName(modelId);
  const catalog = lookupCatalogModel(modelId);
  if (!catalog) return { kind: "unknown", modelId, displayName: display };
  // When multiple peers are simultaneously advertising the same model in
  // `loading`, the honest user-facing state is "the distributed group is
  // forming / recovering". A missing splitGroup snapshot during entry
  // restart or host re-election must not be rendered as four separate solo
  // capacity failures with fake per-machine shortfalls.
  if (node.state === "loading" && warmingPeerCountForModel > 1) {
    return {
      kind: "pooling",
      modelId,
      displayName: catalog.name,
      catalog,
      peerCount: warmingPeerCountForModel,
      pooledGb: pooledGbForModel,
      neededGb: catalog.minVramGb,
      hostingCount: hostingCountForModel,
    };
  }
  // Use the smaller of the two reported numbers — `vramGb` (top-level)
  // is the Metal-budgeted figure for Apple Silicon (~75% of unified
  // memory) and `capability.vramGb` is sometimes the unified-memory
  // total. The conservative number is what actually constrains
  // llama-server's allocator, so it's what we should compare against
  // the catalog's minVramGb.
  //
  // When the node is in a pipeline-parallel split, the model is
  // intentionally NOT supposed to fit on a single host — the whole
  // point of the split is to pool VRAM across `splitGroup.peerIds`.
  // Use the group's pooled total if it's the larger number, so a
  // legitimate split-mode load doesn't get rendered as
  // "underprovisioned · awaiting capacity" with a "Share your machine"
  // CTA when in fact the mesh has plenty of capacity and the worker
  // just hasn't finished bringing its layers up yet.
  const soloVramGb = Math.min(
    node.vramGb || Number.POSITIVE_INFINITY,
    node.capability?.vramGb || Number.POSITIVE_INFINITY,
  );
  const groupVramGb = node.splitGroup?.totalGroupVramGb ?? 0;
  const hostVramGb = Math.max(
    groupVramGb,
    Number.isFinite(soloVramGb) ? soloVramGb : 0,
  );
  if (!Number.isFinite(hostVramGb) || hostVramGb <= 0) {
    return { kind: "unknown", modelId, displayName: display };
  }
  const shortfall = catalog.minVramGb - hostVramGb;
  // Same threshold as app/lib/mesh-fit.ts — sub-gigabyte misses are
  // measurement noise, anything bigger is a real "won't actually
  // serve" verdict.
  if (shortfall > 0.5) {
    return {
      kind: "underprovisioned",
      modelId,
      displayName: catalog.name,
      catalog,
      hostVramGb,
      shortfallGb: shortfall,
    };
  }
  return {
    kind: "fits",
    modelId,
    displayName: catalog.name,
    catalog,
    hostVramGb,
  };
}

function backendColor(backend: string): string {
  const map: Record<string, string> = {
    metal: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    cuda: "text-green-400 bg-green-400/10 border-green-400/20",
    rocm: "text-orange-400 bg-orange-400/10 border-orange-400/20",
    vulkan: "text-purple-400 bg-purple-400/10 border-purple-400/20",
    cpu: "text-[var(--fg-muted)] bg-[var(--bg-elev)] border-[var(--border)]",
  };
  return map[backend] ?? "text-[var(--fg-muted)] bg-[var(--bg-elev)] border-[var(--border)]";
}

// Color/label derivation lives in app/lib/node-display-state.ts so this
// page, the dashboard, and the local /nodes mesh table can never disagree
// about what the same node looks like at the same moment.

// ---------------------------------------------------------------------------
// Node card
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

/**
 * Compare two semver-ish version strings ("0.65.7"). Returns -1 if a<b,
 * 0 if equal, 1 if a>b. Tolerant of extra suffixes ("0.65.7-rc1") which
 * are stripped before numeric comparison.
 */
function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
    v
      .replace(/^v/, "")
      .split(/[.-]/)
      .map((p) => parseInt(p, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/**
 * Highest runtime version observed in the current snapshot. Anything
 * below it is rendered with a small "outdated — update" hint so users
 * with stuck peers can immediately tell whether the fix is "wait for
 * the runtime" or "go update that machine". Computed across all nodes
 * (working + unavailable) so even a stuck peer has something to compare
 * against.
 */
function maxVersion(nodes: { version: string | null }[]): string | null {
  let best: string | null = null;
  for (const n of nodes) {
    if (!n.version) continue;
    if (!best || compareVersions(n.version, best) > 0) best = n.version;
  }
  return best;
}

function NodeCard({
  node,
  history,
  latestVersion,
}: {
  node: MeshNode;
  history?: NodeHistory;
  latestVersion: string | null;
}) {
  const hostname = prettyHostname(node.hostname);
  const isEntryNode = node.hostname?.startsWith("ip-");
  const cap = node.capability;
  const isServing = node.state === "serving";
  const inflightRequests = node.inflightRequests ?? 0;

  // Honest display: show what the node is actually doing right now. We
  // used to "smooth" loading→standby→Ready when the node had been good
  // recently, on the theory that re-elections briefly blip nodes through
  // these states. That assumption was wrong — a node can also get *stuck*
  // in "loading" for minutes (model failing to fit in VRAM, runtime bug,
  // etc.), and the smoothing made the page lie about it ("Ready · serving
  // Qwen3" while inference 503'd because the host never finished loading).
  // Show the real state; if the user sees "Loading 30s" that's the actual
  // information they need.
  const { dot, label: stateLabel } = nodeDisplayState(node);

  // How long has this node been stuck in `loading`? `loadingSince` is
  // tracked in history and reset whenever state moves to anything other
  // than `loading`. Past ~20s it's almost certainly stuck rather than
  // genuinely re-loading.
  const loadingFor =
    node.state === "loading" && history?.loadingSince
      ? Date.now() - history.loadingSince
      : 0;
  const stuckLoading = loadingFor > 20_000;

  // "Online for Xm" when we have history. Tells the user this isn't a
  // flapping node — it's been in the mesh consistently for a while.
  const onlineFor =
    history && !isEntryNode
      ? formatDuration(Date.now() - history.firstSeen)
      : null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5 flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* State indicator */}
          <span className="relative mt-0.5 inline-flex h-2.5 w-2.5 flex-shrink-0">
            {isServing && (
              <span
                aria-hidden
                className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"
              />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dot}`} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--fg)] truncate">
              {isEntryNode ? "Entry node" : hostname}
            </div>
            <div className="text-[11px] text-[var(--fg-muted)] truncate">
              {isEntryNode ? (
                "mesh.closedmesh.com · always-on gateway"
              ) : (
                <>
                  {/* If the node is stuck loading we make it visually
                      distinct so the user immediately sees that this peer
                      is NOT actually serving — even though the green dot
                      means it's connected to the mesh. */}
                  {stuckLoading ? (
                    <span className="text-amber-400">
                      Stuck loading {formatDuration(loadingFor)}
                    </span>
                  ) : node.state === "loading" && loadingFor > 0 ? (
                    <span className="text-amber-300">
                      {stateLabel} {formatDuration(loadingFor)}
                    </span>
                  ) : (
                    stateLabel
                  )}
                  {onlineFor ? ` · online ${onlineFor}` : null}
                  {` · ${node.id.slice(0, 10)}`}
                </>
              )}
            </div>
          </div>
        </div>
        {/* Backend chip */}
        {!isEntryNode && (
          <span
            className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${backendColor(cap.backend)}`}
          >
            {backendLabel(cap.backend, cap.vendor)}
          </span>
        )}
      </div>

      {/* Hardware row */}
      {!isEntryNode && (
        <div className="flex items-center gap-4 text-[12px] text-[var(--fg-muted)]">
          {cap.vramGb > 0 && (
            <span>
              <span className="font-medium text-[var(--fg)]">{cap.vramGb} GB</span> VRAM
            </span>
          )}
          {cap.vramGb === 0 && cap.backend === "cpu" && (
            <span>CPU inference</span>
          )}
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              inflightRequests > 0
                ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
                : "border-[var(--border)] text-[var(--fg-muted)]"
            }`}
            title="Current requests this peer reports over gossip"
          >
            {inflightRequests} in flight
          </span>
          {/* Runtime version. Quietly informational for healthy peers,
              flagged amber if outdated so users can see at a glance
              that this peer needs to update before they go hunting for
              other reasons it might be misbehaving. */}
          {node.version && (() => {
            const isOutdated =
              !!latestVersion &&
              compareVersions(node.version, latestVersion) < 0;
            return (
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  isOutdated ? "text-amber-400" : "text-[var(--fg-muted)]"
                }`}
                title={
                  isOutdated
                    ? `Running v${node.version} — latest is v${latestVersion}. The desktop app self-upgrades the runtime in the background.`
                    : `Runtime v${node.version}`
                }
              >
                v{node.version}
                {isOutdated ? " · outdated" : ""}
              </span>
            );
          })()}
        </div>
      )}

      {/* Pipeline-degraded note. The /api/status route gates this
          server-side and applies it to BOTH host and worker peers in
          a degraded cohort — when any member of the split_group is not
          `state="serving"`, every peer in the cohort is downgraded to
          loading + cleared loadedModels + `pipelineDegraded=true`. The
          two failure shapes we want to name explicitly here:

          1. Host is up, workers are still mmap'ing weights
             (`splitRole === "pipeline_host"`). Worth surfacing the
             worker count + pooled memory so the operator knows what
             they're waiting on.

          2. No host has been elected at all — every peer in the cohort
             is Worker / loading (`splitRole === "pipeline_worker"`).
             This is the May 13 split-brain mode: nothing is going to
             come up without operator intervention. Don't pretend a
             host exists; describe the deadlock honestly. */}
      {node.pipelineDegraded && node.splitGroup && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200">
          {node.splitRole === "pipeline_host" ? (
            <>
              <span className="font-medium text-amber-300">
                Awaiting {Math.max(0, node.splitGroup.peerIds.length - 1)}{" "}
                {node.splitGroup.peerIds.length - 1 === 1 ? "worker" : "workers"}
              </span>{" "}
              to finish loading their layer ranges. This node is the
              elected host, but the cohort can't serve until every worker
              has its layer range resident in memory.
            </>
          ) : (
            <>
              <span className="font-medium text-amber-300">
                Pipeline host not elected.
              </span>{" "}
              {node.splitGroup.peerIds.length} machines are committed to{" "}
              {node.splitGroup.model}, but none has finished claiming the
              host role yet — so there's no peer for traffic to route
              through. Usually the largest peer is still loading weights
              and will advertise itself as host once the model is
              resident. If this stays stuck for several minutes one
              contributor is likely blocking the cohort; restart the
              affected runtime to break the deadlock. (v0.66.21+
              auto-recovers from stuck hosts after a 30-second grace
              window.)
            </>
          )}
        </div>
      )}

      {/* Models. While a node is in `loading`, its `servingModels` lists
          what it's *trying* to load, not what's actually loaded — so we
          render those as muted "loading: X" rather than as ready model
          badges. Without this distinction the card would say "Qwen3-0.6B"
          in the same green pill as a fully serving node, which was the
          original "the page is lying" complaint. */}
      {node.servingModels.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {node.servingModels.map((m) => (
            <span
              key={m}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                node.state === "loading"
                  ? "border-amber-400/30 bg-amber-400/5 text-amber-300"
                  : "border-[var(--border)] bg-[var(--bg)] text-[var(--fg)]"
              }`}
              title={
                node.state === "loading"
                  ? "Model is being loaded into VRAM, not serveable yet"
                  : undefined
              }
            >
              {node.state === "loading" ? "loading: " : ""}
              {prettyModelName(m)}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-[var(--fg-muted)]">
          {isEntryNode ? "Routes inference to worker nodes" : "No models loaded"}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

/**
 * Compact, intentionally un-celebratory row for peers that are connected
 * but have never actually served anything in this session. We render
 * these in a separate "Peers having issues" section instead of giving
 * them a full participating-peer card — a stuck-loading peer is not a
 * "Connected node" in any user-meaningful sense, and showing it with the
 * same hardware-row + model-pill layout as a healthy serving peer reads
 * as misleading bragging.
 */
function IssueNodeRow({
  node,
  history,
  latestVersion,
}: {
  node: MeshNode & { _vanished?: boolean };
  history?: NodeHistory;
  /** Highest runtime version observed in the mesh; used to flag this
   *  peer as outdated if it's running an older build. */
  latestVersion: string | null;
}) {
  const hostname = prettyHostname(node.hostname);
  const loadingFor =
    node.state === "loading" && history?.loadingSince
      ? Date.now() - history.loadingSince
      : 0;
  const reason = (() => {
    if (node._vanished) return "no longer responding";
    if (node.state === "loading") {
      if (loadingFor > 60_000) return `stuck loading for ${formatDuration(loadingFor)}+`;
      if (loadingFor > 20_000) return `stuck loading ${formatDuration(loadingFor)}`;
      if (loadingFor > 0) return `loading ${formatDuration(loadingFor)}`;
      return "loading";
    }
    if (node.state === "unreachable") {
      // Slice 4: a peer that's only in our list because it phoned home
      // its audit (`meshVisibility` non-null) is in a more specific
      // failure mode than a peer that the entry simply stopped
      // hearing from — it's actively reporting in but the entry
      // can't see it. Label accordingly so operators don't conflate
      // the two while debugging.
      if (node.meshVisibility) {
        if (node.meshVisibility.state === "invisible") {
          return node.meshVisibility.softReconnectTriggered
            ? "reporting in but invisible to entry · auto-reconnecting"
            : "reporting in but invisible to entry";
        }
        if (node.meshVisibility.state === "entry_unreachable") {
          return `can't reach entry from this peer · ${node.meshVisibility.consecutiveInvisibleCount} miss(es)`;
        }
      }
      return "unreachable from entry node";
    }
    if (node.state === "offline") return "offline";
    return node.state;
  })();
  const isOutdated =
    !!node.version &&
    !!latestVersion &&
    compareVersions(node.version, latestVersion) < 0;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]/40 px-3 py-2 text-[12px]">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--fg-muted)]/60" />
        <span className="truncate font-medium text-[var(--fg)]/85">{hostname}</span>
        <span className="truncate text-[var(--fg-muted)]">· {reason}</span>
      </div>
      {/* Version is the single most useful debug field for "why is my
          peer stuck". Old runtimes are a frequent cause of stuck-loading
          and host-election bugs (the v0.65.9 release fixes one such bug),
          so calling out outdated peers explicitly turns "the mesh is
          mysteriously broken" into "go update that machine". */}
      {node.version && (
        <span
          className={`flex-shrink-0 font-mono text-[11px] tabular-nums ${
            isOutdated ? "text-amber-400" : "text-[var(--fg-muted)]"
          }`}
          title={
            isOutdated
              ? `Running v${node.version} — latest in this mesh is v${latestVersion}. The desktop app auto-upgrades the runtime within ~6 hours of launch, so this should self-heal soon.`
              : `Runtime v${node.version}`
          }
        >
          v{node.version}
          {isOutdated ? " · outdated" : ""}
        </span>
      )}
    </div>
  );
}

/**
 * Card for a peer that has committed to a model and is currently
 * bringing it up. Replaces the previous "Be the first to share" empty
 * state + collapsed accordion combo, which left the public page
 * reporting "0 machines / 0 models" while a contributor was actively
 * loading — sometimes a model that the host couldn't fit on its own
 * and would never finish bringing online.
 *
 * Two variants driven by `verdict.kind`:
 *
 *   - `underprovisioned`: amber treatment with an "Awaiting capacity"
 *     label and a plain-language explanation of the pooled-memory
 *     shortfall, plus a "Share your machine →" CTA. We deliberately
 *     keep the copy neutral and product-y here — this surface is
 *     public, so no jargon ("mmap", "GGUF", "thrash") and no
 *     defeatist phrasing ("won't load", "will time out"); the user
 *     just needs to know that the mesh is waiting on more memory.
 *
 *   - `pooling`: multiple peers are warming the same model, but the
 *     splitGroup snapshot is not stable yet. Show recovery/loading copy
 *     instead of per-machine solo-capacity math.
 *
 *   - `fits` / `unknown`: muted "Loading X — usually takes 30 s to
 *     2 min" line. Legitimate transient case where the model does fit
 *     and just hasn't finished bringing up yet.
 */
function WarmingUpCard({
  node,
  verdict,
  history,
}: {
  node: MeshNode & { _vanished?: boolean };
  verdict: WarmingVerdict;
  history?: NodeHistory;
}) {
  const hostname = prettyHostname(node.hostname);
  const loadingFor =
    node.state === "loading" && history?.loadingSince
      ? Date.now() - history.loadingSince
      : 0;
  const awaiting = verdict.kind === "underprovisioned";
  // What this machine actually contributes to the pool — the smaller of
  // the two reported numbers, mirroring the verdict math. Surfacing this
  // per-card is what turns "5 machines, no idea why it isn't loading"
  // into "5 machines, here are their budgets, here is the gap".
  const nodeVramGb = Math.min(
    node.vramGb || Number.POSITIVE_INFINITY,
    node.capability?.vramGb || Number.POSITIVE_INFINITY,
  );
  const nodeVramLabel = Number.isFinite(nodeVramGb) && nodeVramGb > 0
    ? `${nodeVramGb.toFixed(nodeVramGb >= 10 ? 0 : 1)} GB`
    : null;
  const pooledShort =
    verdict.kind === "pooling" && verdict.pooledGb < verdict.neededGb;
  const pooledOk =
    verdict.kind === "pooling" && verdict.pooledGb >= verdict.neededGb;
  // Pool large enough but nobody has actually committed to hosting:
  // the election-stall signal that explains "5 machines loading forever".
  const hostStalled =
    verdict.kind === "pooling" &&
    pooledOk &&
    verdict.hostingCount === 0 &&
    verdict.peerCount >= 2;
  return (
    <div
      className={
        "rounded-xl border p-5 " +
        (awaiting
          ? "border-amber-400/40 bg-amber-400/5"
          : "border-[var(--border)] bg-[var(--bg-elev)]")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={
              "mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full " +
              (awaiting ? "bg-amber-400" : "bg-amber-300")
            }
          />
          <div className="min-w-0">
            <div
              className={
                "text-[10px] uppercase tracking-[0.18em] " +
                (awaiting ? "text-amber-300" : "text-[var(--fg-muted)]")
              }
            >
              {awaiting ? "Awaiting capacity" : "Loading"}
            </div>
            <div className="mt-0.5 text-sm font-semibold tracking-tight text-[var(--fg)]">
              {hostname}
              {nodeVramLabel && (
                <span className="ml-2 text-[11px] font-normal text-[var(--fg-muted)]">
                  · {nodeVramLabel} usable
                </span>
              )}
            </div>
            <div className="mt-1 font-mono text-[12px] text-[var(--fg)]/85">
              {verdict.displayName}
              {loadingFor > 0 && !awaiting && (
                <span className="ml-2 text-[11px] text-[var(--fg-muted)]">
                  · {formatDuration(loadingFor)}
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[12px] text-[var(--fg-muted)]">
              {verdict.kind === "underprovisioned" ? (
                <>
                  Needs about{" "}
                  <span className="font-semibold text-[var(--fg)]">
                    {verdict.catalog.minVramGb} GB
                  </span>{" "}
                  of pooled memory to serve. This machine offers{" "}
                  <span className="font-semibold text-[var(--fg)]">
                    {verdict.hostVramGb.toFixed(0)} GB
                  </span>{" "}
                  on its own — additional contributors are needed to pool the
                  remaining{" "}
                  <span className="font-semibold text-[var(--fg)]">
                    ~{Math.ceil(verdict.shortfallGb)} GB
                  </span>{" "}
                  before the model can come online.
                </>
              ) : verdict.kind === "pooling" ? (
                <>
                  {verdict.peerCount} machines advertising this model, pooling{" "}
                  <span
                    className={
                      "font-semibold " +
                      (pooledShort ? "text-amber-300" : "text-[var(--fg)]")
                    }
                  >
                    {verdict.pooledGb.toFixed(0)} GB
                  </span>{" "}
                  against a{" "}
                  <span className="font-semibold text-[var(--fg)]">
                    {verdict.neededGb} GB
                  </span>{" "}
                  requirement.{" "}
                  {pooledShort ? (
                    <>
                      Short by{" "}
                      <span className="font-semibold text-amber-300">
                        ~{Math.ceil(verdict.neededGb - verdict.pooledGb)} GB
                      </span>
                      {" "}— the model won&apos;t finish loading until more
                      capacity joins the mesh.
                    </>
                  ) : hostStalled ? (
                    <>
                      Capacity fits, but{" "}
                      <span className="font-semibold text-amber-300">
                        no peer has been elected as host
                      </span>
                      . Every machine is waiting on another to lead the
                      serve — usually a transient state during peer
                      re-link, but if it persists for more than a minute
                      the mesh is stuck in an election loop and the model
                      can&apos;t come online.
                    </>
                  ) : pooledOk ? (
                    <>Capacity is sufficient; waiting for host election and
                      worker links to settle.</>
                  ) : (
                    <>Waiting for host election and peer links to settle.</>
                  )}
                </>
              ) : verdict.kind === "fits" ? (
                <>
                  Loading model into memory. This usually takes 30 s to 2 min
                  for models in this size range.
                </>
              ) : (
                <>Loading model into memory. This usually takes 30 s to 2 min.</>
              )}
            </div>
          </div>
        </div>
        {awaiting && (
          <a
            href="/download"
            className="shrink-0 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 transition hover:bg-amber-400/20"
          >
            Share your machine →
          </a>
        )}
      </div>
    </div>
  );
}

function SummaryBar({
  status,
  workingPeerCount,
  pooledGb,
  loadingPeerCount,
}: {
  status: MeshStatus;
  /**
   * Non-entry peers that are either currently useful or have been at some
   * point this session — i.e. NOT counted as "having issues". Used as
   * the "machines" headline number so the summary matches the cards
   * shown below: machines == cards in the "Connected nodes" section.
   */
  workingPeerCount: number;
  /** Total usable memory across all non-entry peers right now. */
  pooledGb: number;
  /** Non-entry peers currently in `loading`. */
  loadingPeerCount: number;
}) {
  // "Sharing" = a non-entry node genuinely contributing capacity *right
  // now*. Excludes nodes stuck in `loading` (they self-report a model in
  // `serving_models` while still bringing it up — that's how the page
  // used to claim "1 node sharing GPU" while inference 503'd) and excludes
  // pure clients that aren't serving anything.
  const sharingNodes = status.nodes.filter(
    (n) =>
      !n.hostname?.startsWith("ip-") &&
      n.state !== "loading" &&
      n.state !== "unreachable" &&
      n.state !== "offline" &&
      ((n.capability?.loadedModels?.length ?? 0) > 0 ||
        n.servingModels.length > 0 ||
        n.state === "serving" ||
        n.state === "standby"),
  ).length;
  const models = status.models;
  // Cards shown in "Available machines": everyone we recognise, plus
  // the peers stuck loading whose own card we surface above the empty
  // state. Without including the latter, the page shows "5 machines"
  // in the cards but "0 machines" in the summary — the exact mismatch
  // that prompted this change.
  const totalNodes = Math.max(workingPeerCount, loadingPeerCount);
  const pooledLabel = pooledGb > 0
    ? `${pooledGb >= 100 ? Math.round(pooledGb) : pooledGb.toFixed(0)} GB`
    : "—";

  return (
    <div className="grid grid-cols-4 divide-x divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--bg-elev)]">
      <div className="flex flex-col items-center gap-0.5 px-4 py-4">
        <div className="text-2xl font-semibold tabular-nums text-[var(--fg)]">
          {totalNodes}
        </div>
        <div className="text-[11px] text-[var(--fg-muted)]">
          {totalNodes === 1 ? "machine" : "machines"}
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5 px-4 py-4">
        <div className="text-2xl font-semibold tabular-nums text-[var(--fg)]">
          {pooledLabel}
        </div>
        <div className="text-[11px] text-[var(--fg-muted)]">pooled memory</div>
      </div>
      <div className="flex flex-col items-center gap-0.5 px-4 py-4">
        <div className="text-2xl font-semibold tabular-nums text-[var(--fg)]">
          {models.length}
        </div>
        <div className="text-[11px] text-[var(--fg-muted)]">
          {models.length === 1 ? "model available" : "models available"}
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5 px-4 py-4">
        <div className="text-2xl font-semibold tabular-nums text-emerald-400">
          {sharingNodes}
        </div>
        <div className="text-[11px] text-[var(--fg-muted)]">
          {sharingNodes === 1 ? "node sharing GPU" : "nodes sharing GPU"}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Track per-node history across polls. Used for honest UX signals only —
 * we explicitly do NOT smooth `state` (we used to, and it caused the page
 * to display "Ready · serving Qwen3" for nodes that had been stuck
 * `state="loading"` for minutes, while every chat request 503'd).
 *
 * Fields:
 *   - `firstSeen`: when this node id first appeared in our polls; used to
 *     render the "online for Xm" badge.
 *   - `lastSeen`: most recent poll the node id appeared in; used (in
 *     future) to grey out cards for nodes that have just dropped off.
 *   - `loadingSince`: when state first transitioned to "loading" without
 *     subsequently leaving it. Surfaced as "Loading 30s" on the card so
 *     the user can see whether a node is genuinely loading or stuck.
 *   - `everUseful`: true once we've observed this node in a state that
 *     could actually serve a request (state=serving, OR has loaded models
 *     and isn't loading). Used to demote peers that have *never* served
 *     anything in this session into a separate "having issues" section,
 *     instead of giving them a full participating-peer card. A node that
 *     joined 90 seconds ago and has been stuck loading the entire time
 *     is functionally broken; treating it the same as a healthy serving
 *     peer in the UI was the user-visible lie.
 */
type NodeHistory = {
  firstSeen: number;
  lastSeen: number;
  loadingSince: number | null;
  everUseful: boolean;
};

export default function StatusPage() {
  const [status, setStatus] = useState<MeshStatus | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const historyRef = useRef<Map<string, NodeHistory>>(new Map());
  // Most recent snapshot we saw for each node id. Lets us keep rendering
  // a node for ~30s after it vanishes from the entry node's view, so a
  // flapping peer doesn't cause cards/counts to flicker in and out.
  const lastSnapshotByIdRef = useRef<Map<string, MeshNode>>(new Map());

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as MeshStatus;
        if (cancelled) return;

        // Record per-node history for honest UX badges (online-for, stuck
        // loading detection, "have we ever seen this node actually work?")
        // and snapshot the current state so we can keep rendering
        // briefly-vanished peers across polling gaps.
        const now = Date.now();
        const history = historyRef.current;
        const lastSnapshot = lastSnapshotByIdRef.current;
        for (const node of data.nodes) {
          const prior = history.get(node.id) ?? {
            firstSeen: now,
            lastSeen: now,
            loadingSince: null,
            everUseful: false,
          };
          const loadingSince =
            node.state === "loading"
              ? (prior.loadingSince ?? now)
              : null;
          // "Useful" = could actually serve a request right now. Loading
          // peers don't qualify even if they advertise serving_models —
          // that field lists what they're trying to load, not what's
          // actually loaded.
          const isUsefulNow =
            node.state === "serving" ||
            (node.state !== "loading" &&
              ((node.capability?.loadedModels?.length ?? 0) > 0 ||
                node.servingModels.length > 0));
          history.set(node.id, {
            firstSeen: prior.firstSeen,
            lastSeen: now,
            loadingSince,
            everUseful: prior.everUseful || isUsefulNow,
          });
          lastSnapshot.set(node.id, node);
        }

        // Drop snapshots for peers we haven't seen in over 60s. The
        // render-time grace window is 30s but we keep the snapshot
        // around a bit longer so a peer that briefly comes back inside
        // the window doesn't get a fresh history. After this we treat
        // them as truly gone.
        for (const [id, h] of history.entries()) {
          if (now - h.lastSeen > 60_000) {
            history.delete(id);
            lastSnapshot.delete(id);
          }
        }

        setStatus(data);
        setLastUpdated(new Date());
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) {
          // Poll faster (5s) so we catch the steady-state more often than
          // we catch transient "Loading" states during host re-elections.
          timer = window.setTimeout(tick, 5_000);
        }
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // Categorize nodes for rendering. Two design goals:
  //
  //   1. The main "Connected nodes" list should only show machines that are
  //      actually useful — nothing that's just sitting in `loading`. Showing
  //      a never-served peer alongside a healthy one was the original lie.
  //
  //   2. Disappearance/reappearance of unstable peers must NOT cause
  //      visible flicker. We keep nodes in the "render set" for ~30s after
  //      we last saw them in a poll, so a peer that flaps in and out of
  //      the entry node's view every few seconds doesn't yank cards around.
  //
  // Categories:
  //   - "working": peer is currently useful, OR has been useful at some
  //     point in this session, OR is the entry node. Rendered as a card.
  //   - "unavailable": peer we know about but isn't currently useful and
  //     never has been (stuck loading, unreachable, offline, or recently
  //     vanished entirely). Rendered in a collapsed <details> at the
  //     bottom — present in the DOM for transparency, not in the user's
  //     face. Count is debounced via lastSeen so it doesn't flap.
  const now = Date.now();
  const VANISH_GRACE_MS = 30_000;
  const sortNodes = (a: MeshNode, b: MeshNode) => {
    const aEntry = a.hostname?.startsWith("ip-") ? 1 : 0;
    const bEntry = b.hostname?.startsWith("ip-") ? 1 : 0;
    if (aEntry !== bEntry) return aEntry - bEntry;
    const aServing = a.state === "serving" ? 0 : 1;
    const bServing = b.state === "serving" ? 0 : 1;
    return aServing - bServing;
  };

  // Build a render set that includes (a) every node in the current
  // snapshot, plus (b) any node we saw recently but is missing from THIS
  // snapshot. The (b) part is what makes flapping peers stop flickering:
  // if a peer disappears for one poll, we still render its last-known
  // state for up to 30s before actually dropping it. (Mutation of the
  // ref happens in the polling callback, not during render.)
  type RenderNode = MeshNode & { _vanished: boolean };
  const currentNodes = status?.nodes ?? [];
  const currentIds = new Set(currentNodes.map((n) => n.id));
  const lastSnapshotRef = lastSnapshotByIdRef.current;

  const renderNodes: RenderNode[] = [];
  for (const n of currentNodes) {
    renderNodes.push({ ...n, _vanished: false });
  }
  for (const [id, snap] of lastSnapshotRef.entries()) {
    if (currentIds.has(id)) continue;
    const h = historyRef.current.get(id);
    if (!h) continue;
    const goneFor = now - h.lastSeen;
    if (goneFor < VANISH_GRACE_MS) {
      renderNodes.push({ ...snap, _vanished: true });
    }
    // Past the grace window: ignore here. Cleanup of the ref happens
    // inside the poll callback when we re-process the next snapshot.
  }

  const isUnavailable = (n: RenderNode): boolean => {
    if (n.hostname?.startsWith("ip-")) return false;
    const h = historyRef.current.get(n.id);
    // A peer that has actually served in this session stays in the
    // "Available machines" list even during a transient vanish — the
    // 30s render grace handles that without yanking the card. We only
    // demote it once the grace expires and we drop it from renderNodes
    // entirely.
    if (h?.everUseful) return false;
    return (
      n._vanished ||
      n.state === "loading" ||
      n.state === "unreachable" ||
      n.state === "offline"
    );
  };
  const unavailableNodes = renderNodes.filter(isUnavailable).sort(sortNodes);
  const workingNodes = renderNodes
    .filter((n) => !isUnavailable(n))
    .sort(sortNodes);

  // Peers in the loading state that are actively trying to bring a
  // model up. We surface these as full-width cards (with a fit verdict)
  // above the empty state, so the public page actually reports
  // "MacBook-Air-de-al-2 is warming up Mixtral 8x7B — won't actually
  // load on its own, needs 24 GB more memory" instead of the previous
  // "Be the first to share" lie + collapsed accordion.
  const warmingPeerCountsByModel = new Map<string, number>();
  const pooledGbByModel = new Map<string, number>();
  // Per-model: how many peers across the whole mesh — warming AND
  // working — have hosted_models actually pointing at this model.
  // Zero means election is stuck; this is the deadlock signal that
  // hides behind "5 machines loading forever".
  const hostingCountByModel = new Map<string, number>();
  for (const n of renderNodes) {
    for (const m of n.capability?.loadedModels ?? []) {
      if (n.state === "serving" || (n.capability?.loadedModels?.length ?? 0) > 0) {
        hostingCountByModel.set(m, (hostingCountByModel.get(m) ?? 0) + 1);
      }
    }
  }
  for (const n of unavailableNodes) {
    if (n.state !== "loading") continue;
    const modelId = n.servingModels[0];
    if (!modelId) continue;
    warmingPeerCountsByModel.set(
      modelId,
      (warmingPeerCountsByModel.get(modelId) ?? 0) + 1,
    );
    // Use the smaller of vramGb / capability.vramGb so the pooled figure
    // reflects what each peer can actually contribute, not whichever of
    // the two reported numbers is larger.
    const nodeVramGb = Math.min(
      n.vramGb || Number.POSITIVE_INFINITY,
      n.capability?.vramGb || Number.POSITIVE_INFINITY,
    );
    if (Number.isFinite(nodeVramGb) && nodeVramGb > 0) {
      pooledGbByModel.set(
        modelId,
        (pooledGbByModel.get(modelId) ?? 0) + nodeVramGb,
      );
    }
  }
  const warmingUpNodes = unavailableNodes
    .map((n) => ({
      node: n,
      verdict: warmingUpVerdict(
        n,
        warmingPeerCountsByModel.get(n.servingModels[0] ?? "") ?? 1,
        pooledGbByModel.get(n.servingModels[0] ?? "") ?? 0,
        hostingCountByModel.get(n.servingModels[0] ?? "") ?? 0,
      ),
    }))
    .filter((x): x is { node: typeof x.node; verdict: WarmingVerdict } =>
      x.verdict !== null,
    );
  // Anything in `unavailableNodes` that ISN'T a warming-up peer (e.g.
  // unreachable, vanished, recently offline) still goes into the
  // collapsed details section below — those don't have anything
  // interesting to say to a public visitor and we don't want to fill
  // the page with broken-peer noise.
  const trulyUnavailableNodes = unavailableNodes.filter(
    (n) => !warmingUpNodes.some((w) => w.node.id === n.id),
  );
  // Highest version observed across BOTH lists. Used to flag outdated
  // peers in any section. Computed once per render so all rows agree
  // on what "latest" means.
  const latestVersion = maxVersion(renderNodes);

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)] text-[var(--fg)]">
      <PublicHeader status={<MeshLiveStatus variant="header" />} />

      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        {/* Page heading */}
        <div className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-2">
            Live mesh status
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            What&apos;s running right now
          </h1>
          <p className="mt-2 text-[14px] text-[var(--fg-muted)]">
            Machines connected to the ClosedMesh network and the models they&apos;re currently serving.
            {lastUpdated && (
              <span className="ml-1">
                Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.
              </span>
            )}
          </p>
        </div>

        {/* Loading state */}
        {!status && !error && (
          <div className="space-y-4">
            <div className="h-24 animate-pulse rounded-xl bg-[var(--bg-elev)]" />
            <div className="h-28 animate-pulse rounded-xl bg-[var(--bg-elev)]" />
            <div className="h-28 animate-pulse rounded-xl bg-[var(--bg-elev)]" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <div className="text-sm font-medium text-red-400">Mesh unreachable</div>
            <div className="mt-1 text-[12px] text-[var(--fg-muted)]">
              Could not reach the entry node. Retrying automatically.
            </div>
          </div>
        )}

        {/* Content */}
        {status && (
          <div className="space-y-6">
            <SummaryBar
              status={status}
              workingPeerCount={
                workingNodes.filter(
                  (n) => !n.hostname?.startsWith("ip-"),
                ).length
              }
              loadingPeerCount={
                renderNodes.filter(
                  (n) =>
                    !n.hostname?.startsWith("ip-") &&
                    n.state === "loading",
                ).length
              }
              pooledGb={renderNodes
                .filter((n) => !n.hostname?.startsWith("ip-"))
                .reduce((acc, n) => {
                  const v = Math.min(
                    n.vramGb || Number.POSITIVE_INFINITY,
                    n.capability?.vramGb || Number.POSITIVE_INFINITY,
                  );
                  return acc + (Number.isFinite(v) && v > 0 ? v : 0);
                }, 0)}
            />

            {/* Models list */}
            {status.models.length > 0 && (
              <div>
                <div className="mb-3 text-[11px] uppercase tracking-widest text-[var(--fg-muted)]">
                  Available models
                </div>
                <div className="flex flex-wrap gap-2">
                  {status.models.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1 text-[12px] font-medium text-[var(--fg)]"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {prettyModelName(m)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Working nodes — peers that are currently useful or have
                been useful at some point in this session, plus the entry
                node. */}
            <div>
              <div className="mb-3 text-[11px] uppercase tracking-widest text-[var(--fg-muted)]">
                Available machines
              </div>
              {workingNodes.some((n) => !n.hostname?.startsWith("ip-")) ? (
                <div className="space-y-3">
                  {workingNodes.map((node) => (
                    <NodeCard
                      key={node.id}
                      node={node}
                      history={historyRef.current.get(node.id)}
                      latestVersion={latestVersion}
                    />
                  ))}
                </div>
              ) : warmingUpNodes.length > 0 ? (
                // At least one peer is actively trying to bring a model
                // up. Show what they're loading and whether it'll fit
                // instead of the misleading "Be the first to share"
                // empty state — the user IS sharing, the question is
                // whether the model is actually going to load. See
                // WarmingUpCard for the underprovisioned vs fits split.
                <div className="space-y-3">
                  {warmingUpNodes.map(({ node, verdict }) => (
                    <WarmingUpCard
                      key={node.id}
                      node={node}
                      verdict={verdict}
                      history={historyRef.current.get(node.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-6 text-center">
                  <div className="text-sm font-medium text-[var(--fg)]">
                    No machines are sharing right now
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--fg-muted)]">
                    The mesh is up but no peer has finished loading a model.
                    {" "}
                    <a
                      href="/download"
                      className="text-[var(--accent)] hover:underline"
                    >
                      Be the first to share →
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Truly-broken peers — unreachable, vanished, recently
                offline. Warming-up peers no longer land here; they got
                promoted to the main "Available machines" section above
                where they belong. This stays collapsed because there's
                genuinely nothing actionable for a public visitor to do
                about a stranger's offline node. */}
            {trulyUnavailableNodes.length > 0 && (
              <details className="group rounded-xl border border-[var(--border)] bg-[var(--bg-elev)]/40 px-4 py-3 text-[12px]">
                <summary className="flex cursor-pointer items-center justify-between gap-2 text-[var(--fg-muted)] [&::-webkit-details-marker]:hidden">
                  <span>
                    {trulyUnavailableNodes.length} machine
                    {trulyUnavailableNodes.length === 1 ? "" : "s"} connected
                    but offline or unreachable
                  </span>
                  <span className="text-[var(--fg-muted)] transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <div className="mt-3 space-y-2">
                  {trulyUnavailableNodes.map((node) => (
                    <IssueNodeRow
                      key={node.id}
                      node={node}
                      history={historyRef.current.get(node.id)}
                      latestVersion={latestVersion}
                    />
                  ))}
                </div>
              </details>
            )}

            {/* Footer note */}
            <p className="text-center text-[11px] text-[var(--fg-muted)]">
              Refreshes every 5 seconds &middot;{" "}
              <a href="/download" className="text-[var(--accent)] hover:underline">
                Add your machine to the mesh
              </a>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
