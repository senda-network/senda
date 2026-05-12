"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Cross-route download state.
 *
 * Why this lives in a context provider on the `(control)` layout instead of
 * `useState` inside `models/page.tsx`: the streaming `fetch` to
 * `/api/control/models/download` returns NDJSON that's read off
 * `res.body.getReader()` for the entire duration of the download (often
 * minutes for a 30 GB GGUF). Previously the reader loop, the `downloads`
 * state, and the rendered progress UI all lived in `ModelsPage`. The
 * moment the user navigated to Mesh / Status / Logs, Next.js unmounted
 * `ModelsPage`, the React state evaporated, and crucially the reader loop
 * lost its only consumer — but the underlying child process kept running
 * because the controller route doesn't wire `req.signal` to `child.kill`,
 * so the actual download finished invisibly while the dashboard pretended
 * nothing was happening.
 *
 * Hoisting the state up to the persistent `(control)/layout.tsx` keeps the
 * reader loop alive across route changes; the user can hop to Mesh to see
 * pooled VRAM math and come back to Models with the progress bar still
 * ticking. We deliberately do NOT persist to sessionStorage — a hard
 * reload should re-poll `/api/control/models/list` and let the runtime's
 * own download-resume logic continue any partial transfer rather than
 * trusting an opaque snapshot of UI state.
 */

export type DownloadEvent =
  | { kind: "stdout" | "stderr"; text: string }
  | { kind: "progress"; percent: number; bytes: number; total: number }
  | { kind: "done"; ok: boolean; code: number }
  | { kind: "error"; message: string };

export type DownloadState = {
  id: string;
  phase: "running" | "done" | "failed";
  percent: number;
  bytes: number;
  total: number;
  lastLine: string;
  error?: string;
};

type DownloadsApi = {
  downloads: Record<string, DownloadState>;
  /** Begin a download. Idempotent: re-calling for the same id while one
   *  is already running is a no-op rather than spawning a second CLI.
   *
   *  `sizeBytes` is forwarded to the controller so it can pre-flight
   *  free disk space against the model's nominal GGUF size before
   *  spawning the CLI. Pass it whenever the caller knows the size
   *  (every catalog row does) — passing `undefined` is safe but the
   *  user only finds out about disk-full mid-download instead of up
   *  front. */
  startDownload: (id: string, sizeBytes?: number) => Promise<void>;
  /** Drop a finished/failed entry from the visible list. Running entries
   *  cannot be dismissed — the user has to wait for them to finish or
   *  fail (we don't expose cancel because the controller doesn't either,
   *  and lying about cancel would leave a half-downloaded GGUF on disk). */
  dismissDownload: (id: string) => void;
  /** Set the on-success callback once. Used by the Models page so its
   *  local installed-model list refresh fires the moment a download
   *  finishes, even if the user is currently on a different route. The
   *  callback is fire-and-forget; we don't await its return. */
  setOnComplete: (cb: ((id: string) => void) | null) => void;
};

const DownloadsContext = createContext<DownloadsApi | null>(null);

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>(
    {},
  );

  // Refs we want to mutate without re-rendering: the active reader set
  // (so `startDownload` can dedupe) and the on-complete callback (so
  // changing it from a child page doesn't tear down the provider).
  const activeRef = useRef<Set<string>>(new Set());
  const onCompleteRef = useRef<((id: string) => void) | null>(null);

  const setOnComplete = useCallback((cb: ((id: string) => void) | null) => {
    onCompleteRef.current = cb;
  }, []);

  const dismissDownload = useCallback((id: string) => {
    setDownloads((d) => {
      const cur = d[id];
      if (!cur || cur.phase === "running") return d;
      const next = { ...d };
      delete next[id];
      return next;
    });
  }, []);

  const startDownload = useCallback(async (id: string, sizeBytes?: number) => {
    if (activeRef.current.has(id)) return;
    activeRef.current.add(id);

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

    try {
      const res = await fetch("/api/control/models/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          typeof sizeBytes === "number" && Number.isFinite(sizeBytes)
            ? { id, sizeBytes }
            : { id },
        ),
      });

      if (!res.ok || !res.body) {
        let message = `request returned ${res.status}`;
        try {
          const err = (await res.json()) as { message?: string };
          message = err.message ?? message;
        } catch {
          // body might already be the stream — nothing to read
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
          if (ev.kind === "stdout" || ev.kind === "stderr") {
            lastAnyLine = ev.text;
            if (ev.kind === "stderr") lastStderr = ev.text;
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
              if (!ev.ok) {
                next.error =
                  lastStderr ??
                  lastAnyLine ??
                  `Download failed (exit ${ev.code}).`;
              }
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

      if (okFinal && onCompleteRef.current) {
        try {
          onCompleteRef.current(id);
        } catch {
          // a stale page subscriber shouldn't crash the provider
        }
      }
    } catch (e) {
      setDownloads((d) => ({
        ...d,
        [id]: {
          ...(d[id] ?? {
            id,
            phase: "running",
            percent: 0,
            bytes: 0,
            total: 0,
            lastLine: "",
          }),
          phase: "failed",
          error: e instanceof Error ? e.message : "request failed",
        },
      }));
    } finally {
      activeRef.current.delete(id);
    }
  }, []);

  const api = useMemo<DownloadsApi>(
    () => ({ downloads, startDownload, dismissDownload, setOnComplete }),
    [downloads, startDownload, dismissDownload, setOnComplete],
  );

  return (
    <DownloadsContext.Provider value={api}>
      {children}
    </DownloadsContext.Provider>
  );
}

export function useDownloads(): DownloadsApi {
  const ctx = useContext(DownloadsContext);
  if (!ctx) {
    throw new Error(
      "useDownloads must be used inside <DownloadsProvider> — wrap the (control) layout.",
    );
  }
  return ctx;
}
