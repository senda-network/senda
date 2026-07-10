"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMeshStatus, type NodeSummary } from "./use-mesh-status";

/**
 * Runtime service state from the local controller. Mirrors the inline type in
 * the dashboard; lives here now so the global Sharing control, the Machine
 * panel, and the dashboard can all share one definition and one poll.
 */
export type ServiceState =
  | { state: "running"; pid: number | null }
  | { state: "stopped" }
  | { state: "unknown"; reason: string }
  | { state: "unavailable" };

export type ControlStatus = {
  available: boolean;
  binPath: string | null;
  service: ServiceState;
  publicDeployment: boolean;
};

const POLL_MS = 4000;

export function useControlStatus() {
  const [control, setControl] = useState<ControlStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/control/status", { cache: "no-store" });
      const data = (await res.json()) as ControlStatus;
      setControl(data);
    } catch {
      // transient — keep last good
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { control, loading, refresh };
}

export type SharingState =
  | "loading"
  | "running"
  | "stopped"
  | "starting"
  | "stopping"
  | "public";

/**
 * The single source of truth for "am I sharing?" — blends the controller
 * service state with live mesh connectivity (the runtime can be up outside
 * launchd, in which case the service reads "stopped" but we're clearly on the
 * mesh). Exposes start/stop with an optimistic in-flight state so the whole UI
 * agrees during transitions.
 */
export function useSharing() {
  const { control, loading, refresh } = useControlStatus();
  const mesh = useMeshStatus();
  const [busy, setBusy] = useState<null | "start" | "stop">(null);
  const [toast, setToast] = useState<string | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const selfNode: NodeSummary | null =
    mesh.nodes.find((n) => n.isSelf) ?? null;
  const meshConnected = selfNode !== null;
  const running = control?.service.state === "running" || meshConnected;
  const publicDeployment = control?.publicDeployment ?? false;

  const state: SharingState = publicDeployment
    ? "public"
    : busy === "start"
      ? "starting"
      : busy === "stop"
        ? "stopping"
        : loading && !control
          ? "loading"
          : running
            ? "running"
            : "stopped";

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

  const start = useCallback(() => act("start"), [act]);
  const stop = useCallback(() => act("stop"), [act]);

  const peerCount = mesh.nodeCount;
  const loadedModel = mesh.models[0] ?? null;

  return {
    control,
    mesh,
    selfNode,
    state,
    running,
    busy,
    toast,
    peerCount,
    loadedModel,
    available: control?.available ?? false,
    publicDeployment,
    start,
    stop,
    refresh,
  };
}
