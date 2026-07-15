/**
 * Controller-side user preferences, stored at
 * `~/.senda/controller-settings.json`.
 *
 * Single source of truth for the settings shape, shared by:
 *   - `app/api/control/settings/route.ts`     (read/write from the UI)
 *   - `app/api/control/diagnostics/route.ts`  (reads the opt-in flag +
 *                                              the stable install id)
 *
 * This module is server-only (it touches `node:fs`) and must never be
 * imported from a client component.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type Backend = "auto" | "metal" | "cuda" | "rocm" | "vulkan" | "cpu";

export type ControllerSettings = {
  defaultModel: string | null;
  backend: Backend;
  publicOrigins: string[];
  /**
   * When true, quitting the desktop app leaves the runtime daemon running
   * in the background (still serving the public mesh). When false (the
   * default), the desktop app stops the launchd-supervised service on
   * quit so closing the app actually leaves the mesh — matching what
   * users expect from CMD+Q. The desktop shell reads this file directly
   * on quit; nothing in the controller reads it.
   */
  keepMeshRunningAfterQuit: boolean;
  /**
   * Opt-in: when true, the controller may send anonymous diagnostic
   * reports (versions, hardware class, scrubbed error logs — never chat
   * content) to senda.network when something looks stuck. Default off.
   * A manual "Send diagnostic report" click is treated as explicit
   * consent regardless of this flag; this only governs *automatic*
   * sends.
   */
  shareDiagnostics: boolean;
  /**
   * Random, non-identifying id minted once per install so diagnostic
   * reports from the same machine can be de-duplicated and correlated
   * without tying them to a person. Null until first generated. Not a
   * user setting — never surfaced in the UI, never editable.
   */
  installId: string | null;
};

export const DEFAULT_CONTROLLER_SETTINGS: ControllerSettings = {
  defaultModel: null,
  backend: "auto",
  publicOrigins: ["https://senda.network"],
  keepMeshRunningAfterQuit: false,
  shareDiagnostics: false,
  installId: null,
};

export const SETTINGS_PATH = path.join(
  homedir(),
  ".senda",
  "controller-settings.json",
);

export function isBackend(v: unknown): v is Backend {
  return (
    v === "auto" ||
    v === "metal" ||
    v === "cuda" ||
    v === "rocm" ||
    v === "vulkan" ||
    v === "cpu"
  );
}

export async function readControllerSettings(): Promise<ControllerSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ControllerSettings>;
    return {
      defaultModel:
        typeof parsed.defaultModel === "string" || parsed.defaultModel === null
          ? parsed.defaultModel
          : DEFAULT_CONTROLLER_SETTINGS.defaultModel,
      backend: isBackend(parsed.backend)
        ? parsed.backend
        : DEFAULT_CONTROLLER_SETTINGS.backend,
      publicOrigins: Array.isArray(parsed.publicOrigins)
        ? parsed.publicOrigins.filter(
            (o): o is string => typeof o === "string",
          )
        : DEFAULT_CONTROLLER_SETTINGS.publicOrigins,
      keepMeshRunningAfterQuit:
        typeof parsed.keepMeshRunningAfterQuit === "boolean"
          ? parsed.keepMeshRunningAfterQuit
          : DEFAULT_CONTROLLER_SETTINGS.keepMeshRunningAfterQuit,
      shareDiagnostics:
        typeof parsed.shareDiagnostics === "boolean"
          ? parsed.shareDiagnostics
          : DEFAULT_CONTROLLER_SETTINGS.shareDiagnostics,
      installId:
        typeof parsed.installId === "string" && parsed.installId.length > 0
          ? parsed.installId
          : DEFAULT_CONTROLLER_SETTINGS.installId,
    };
  } catch {
    return { ...DEFAULT_CONTROLLER_SETTINGS };
  }
}

export async function writeControllerSettings(
  s: ControllerSettings,
): Promise<void> {
  await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2) + "\n");
}

/**
 * Return the stable install id, minting and persisting one on first
 * call. Kept separate from the UI write path so a diagnostic send can
 * lazily create the id without the user ever visiting Settings.
 */
export async function ensureInstallId(): Promise<string> {
  const settings = await readControllerSettings();
  if (settings.installId) return settings.installId;
  const installId = randomUUID();
  await writeControllerSettings({ ...settings, installId });
  return installId;
}
