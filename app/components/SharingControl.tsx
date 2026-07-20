"use client";

import Link from "next/link";
import { useSharing } from "../lib/use-control-status";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Popover } from "./ui/Popover";
import { Stat } from "./ui/Stat";
import { cn } from "./ui/cn";

const BACKEND_LABEL: Record<string, string> = {
  metal: "Apple Silicon",
  cuda: "NVIDIA (CUDA)",
  rocm: "AMD (ROCm)",
  vulkan: "GPU (Vulkan)",
  cpu: "CPU",
};

/**
 * The single, global "am I sharing?" control. Replaces the old sidebar footer,
 * StatusPill, and the dashboard hero as the one place that answers the
 * question — and the one place to start or stop. The pill reflects live state;
 * the popover carries machine health and the start/stop action.
 */
export function SharingControl() {
  const s = useSharing();

  if (s.publicDeployment) return null;

  const tone =
    s.state === "running"
      ? "success"
      : s.state === "starting" || s.state === "stopping" || s.state === "loading"
        ? "warn"
        : "neutral";

  const label =
    s.state === "running"
      ? "On mesh"
      : s.state === "starting"
        ? "Joining…"
        : s.state === "stopping"
          ? "Leaving…"
          : s.state === "loading"
            ? "Checking…"
            : "Offline";

  const node = s.selfNode;
  const backend = node ? BACKEND_LABEL[node.capability.backend] ?? node.capability.backend : "—";
  const memGb = node ? node.capability.vramGb || node.vramGb || 0 : 0;
  const loadedCount = node?.capability.loadedModels.length ?? 0;
  const busy = s.busy !== null;

  return (
    <Popover
      align="end"
      width={300}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
            "border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--border-strong)]",
            open && "border-[var(--border-strong)]",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              tone === "success" && "bg-[var(--success)] pulse-soft",
              tone === "warn" && "bg-[var(--warn)] pulse-soft",
              tone === "neutral" && "bg-[var(--fg-subtle)]",
            )}
          />
          <span className="text-[var(--fg)]">{label}</span>
          {s.state === "running" && s.peerCount > 0 && (
            <span className="text-[var(--fg-muted)]">
              · {s.peerCount} {s.peerCount === 1 ? "peer" : "peers"}
            </span>
          )}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="text-[var(--fg-subtle)]"
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
      )}
    >
      {({ close }) => (
        <div>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-[var(--fg)]">
                  This machine
                </div>
                <div className="mt-0.5 text-[12px] text-[var(--fg-muted)]">
                  {node?.hostname ?? "Local runtime"}
                </div>
              </div>
              <Badge tone={tone} dot pulse={tone !== "neutral"}>
                {label}
              </Badge>
            </div>
          </div>

          {s.state === "running" && node && (
            <div className="grid grid-cols-3 gap-3 border-b border-[var(--border)] px-4 py-3">
              <Stat label="Chip" value={<span className="text-[13px]">{backend}</span>} />
              <Stat
                label="Memory"
                value={<span className="text-[13px]">{memGb ? `${memGb} GB` : "—"}</span>}
              />
              <Stat
                label="Models"
                value={<span className="text-[13px]">{loadedCount}</span>}
              />
            </div>
          )}

          <div className="px-4 py-3">
            {s.state === "running" ? (
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={busy}
                onClick={() => s.stop()}
              >
                {s.busy === "stop" ? "Leaving…" : "Leave mesh"}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                disabled={busy || s.state === "loading"}
                onClick={() => s.start()}
              >
                {s.busy === "start" ? "Joining…" : "Join mesh"}
              </Button>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--fg-muted)]">
              {s.state === "running"
                ? "Your machine is on the mesh and serving what it can."
                : "This app joins the mesh by default. Start if the runtime stopped — Stop only if you need to leave temporarily."}
            </p>
            <Link
              href="/dashboard"
              onClick={close}
              className="mt-3 inline-flex items-center gap-1 text-[12px] text-[var(--accent)] hover:underline"
            >
              Machine details
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
