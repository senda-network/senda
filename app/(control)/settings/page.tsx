"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { useCatalog } from "../../lib/use-catalog";
import { Button } from "../../components/ui/Button";
import { Switch } from "../../components/ui/Switch";
import { ThemeToggle } from "../../components/ui/ThemeToggle";

type Backend = "auto" | "metal" | "cuda" | "rocm" | "vulkan" | "cpu";

type Settings = {
  defaultModel: string | null;
  backend: Backend;
  publicOrigins: string[];
  keepMeshRunningAfterQuit: boolean;
  shareDiagnostics: boolean;
};

type LocalModel = { id: string };

type Save = "idle" | "saving" | "saved" | "error";

const BACKEND_LABEL: Record<Backend, string> = {
  auto: "Auto-detect (recommended)",
  metal: "Apple Metal",
  cuda: "NVIDIA CUDA",
  rocm: "AMD ROCm",
  vulkan: "Vulkan",
  cpu: "CPU only",
};

export default function SettingsPage() {
  const { catalog } = useCatalog();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [save, setSave] = useState<Save>("idle");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const dirty = useRef(false);

  // Initial load.
  useEffect(() => {
    (async () => {
      try {
        const [sRes, mRes] = await Promise.all([
          fetch("/api/control/settings", { cache: "no-store" }),
          fetch("/api/control/models/list", { cache: "no-store" }),
        ]);
        const sData = (await sRes.json()) as { ok: boolean; settings?: Settings };
        const mData = (await mRes.json()) as {
          ok: boolean;
          models: { id: string }[];
        };
        if (sData.ok && sData.settings) setSettings(sData.settings);
        if (mData.models) setLocalModels(mData.models);
      } catch (e) {
        setSaveMsg(e instanceof Error ? e.message : "couldn't load settings");
        setSave("error");
      }
    })();
  }, []);

  const update = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      dirty.current = true;
      setSettings((cur) => (cur ? { ...cur, [key]: value } : cur));
    },
    [],
  );

  const persist = useCallback(async () => {
    if (!settings) return;
    setSave("saving");
    setSaveMsg(null);
    try {
      const res = await fetch("/api/control/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        settings?: Settings;
      };
      if (!data.ok) {
        setSave("error");
        setSaveMsg(data.message ?? "save failed");
        return;
      }
      if (data.settings) setSettings(data.settings);
      dirty.current = false;
      setSave("saved");
      setSaveMsg("Saved.");
      setTimeout(() => setSave("idle"), 1500);
    } catch (e) {
      setSave("error");
      setSaveMsg(e instanceof Error ? e.message : "save failed");
    }
  }, [settings]);

  const downloadedIds = new Set(localModels.map((m) => m.id));
  const downloadedCatalog = catalog.filter((m) => downloadedIds.has(m.id));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Settings"
        subtitle="How Senda runs on this machine."
      />

      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
          <Card
            eyebrow="Appearance"
            title="Theme"
            hint="Match your system, or force light or dark. Applies everywhere in Senda."
          >
            <ThemeToggle />
          </Card>

          <Card
            eyebrow="Background"
            title="Keep running after I quit Senda"
            hint="Off by default: quit stops the runtime and clears login autostart — nothing runs unless Senda is open. Turn on only if you want a headless always-on node (stays up after quit and at login)."
          >
            <div className="flex items-center justify-between gap-4">
              <Switch
                checked={settings?.keepMeshRunningAfterQuit ?? false}
                disabled={!settings}
                onChange={(v) => update("keepMeshRunningAfterQuit", v)}
              />
              <span className="text-[12px] text-[var(--fg-muted)]">
                {settings?.keepMeshRunningAfterQuit ?? false
                  ? "On — quitting leaves the runtime up (and at login)"
                  : "Off — quitting stops the runtime"}
              </span>
            </div>
          </Card>

          <Card
            eyebrow="Diagnostics"
            title="Help improve Senda"
            hint="When something looks stuck, send an anonymous diagnostic report — runtime and app versions, your hardware class, and scrubbed error logs. Never your chat messages. You can also send one manually from the loading card. Off by default."
          >
            <div className="flex items-center justify-between gap-4">
              <Switch
                checked={settings?.shareDiagnostics ?? false}
                disabled={!settings}
                onChange={(v) => update("shareDiagnostics", v)}
              />
              <span className="text-[12px] text-[var(--fg-muted)]">
                {settings?.shareDiagnostics
                  ? "On — sends reports automatically when stuck"
                  : "Off — nothing is sent automatically"}
              </span>
            </div>
          </Card>

          <Card
            eyebrow="Chat"
            title="Default chat model"
            hint="What chat asks for when you don't pick one per-conversation. Different from a machine's Startup model (what it loads on boot). Falls back to whatever's loaded if your default isn't ready."
          >
            <select
              value={settings?.defaultModel ?? ""}
              disabled={!settings}
              onChange={(e) =>
                update("defaultModel", e.target.value || null)
              }
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2 text-sm text-[var(--fg)] focus:border-[var(--accent)]/60 focus:outline-none disabled:opacity-50"
            >
              <option value="">Auto — first available</option>
              {downloadedCatalog.length > 0 && (
                <optgroup label="On your mesh">
                  {downloadedCatalog.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {catalog.filter((m) => !downloadedIds.has(m.id)).length > 0 && (
                <optgroup label="Catalog (not downloaded yet)">
                  {catalog
                    .filter((m) => !downloadedIds.has(m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </optgroup>
              )}
              {localModels
                .filter((m) => !catalog.find((c) => c.id === m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
            </select>
          </Card>

          <details className="group rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)]/60 p-5 open:bg-[var(--bg-elev)]">
            <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold tracking-tight text-[var(--fg)]">
              <span>
                <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">
                  Advanced
                </span>
                <span className="block text-base">For power users</span>
              </span>
              <span className="text-[var(--fg-muted)] transition group-open:rotate-90">
                ›
              </span>
            </summary>
            <div className="mt-4 flex flex-col gap-5">
              <Field
                label="Hardware override"
                hint="Force a specific accelerator. Default auto-detect is right almost always."
              >
                <select
                  value={settings?.backend ?? "auto"}
                  disabled={!settings}
                  onChange={(e) =>
                    update("backend", e.target.value as Backend)
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2 text-sm text-[var(--fg)] focus:border-[var(--accent)]/60 focus:outline-none disabled:opacity-50"
                >
                  {(Object.keys(BACKEND_LABEL) as Backend[]).map((b) => (
                    <option key={b} value={b}>
                      {BACKEND_LABEL[b]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Trusted web origins"
                hint="Browser pages allowed to call this controller cross-origin (one per line). Add your team's intranet here if you want chat-from-anywhere."
              >
                <textarea
                  value={(settings?.publicOrigins ?? []).join("\n")}
                  disabled={!settings}
                  onChange={(e) =>
                    update(
                      "publicOrigins",
                      e.target.value
                        .split(/\r?\n/)
                        .map((s) => s.trim())
                        .filter((s) => s.length > 0),
                    )
                  }
                  rows={3}
                  className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2 font-mono text-xs text-[var(--fg)] focus:border-[var(--accent)]/60 focus:outline-none disabled:opacity-50"
                  placeholder="https://senda.network"
                />
              </Field>
            </div>
          </details>

          <div className="sticky bottom-0 -mx-6 flex items-center justify-between border-t border-[var(--border)] bg-[var(--bg)]/85 px-6 py-3 backdrop-blur">
            <span className="text-[12px] text-[var(--fg-muted)]">
              {save === "saving"
                ? "Saving…"
                : save === "saved"
                  ? saveMsg
                  : save === "error"
                    ? saveMsg
                    : "Changes apply on save."}
            </span>
            <Button
              variant="primary"
              onClick={persist}
              disabled={save === "saving" || !settings}
            >
              {save === "saving" ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

function Card({
  eyebrow,
  title,
  hint,
  children,
}: {
  eyebrow: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">
        {eyebrow}
      </div>
      <div className="mt-0.5 text-base font-semibold tracking-tight text-[var(--fg)]">
        {title}
      </div>
      <div className="mt-1 text-[12px] text-[var(--fg-muted)]">{hint}</div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <label className="text-[11px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">
          {label}
        </label>
      </div>
      {children}
      <div className="mt-1.5 text-[11px] text-[var(--fg-muted)]">{hint}</div>
    </div>
  );
}

