import { NextResponse } from "next/server";
import { isPublic } from "../_lib";
import {
  DEFAULT_CONTROLLER_SETTINGS,
  isBackend,
  readControllerSettings,
  writeControllerSettings,
  type ControllerSettings,
} from "../../../lib/controller-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Controller-side user preferences.
 *
 * These live in `~/.senda/controller-settings.json` and are read by the
 * controller UI itself plus, eventually, the runtime when it boots. Today
 * the runtime ignores everything except `defaultModel` (used by `/api/chat`
 * when the request omits a model). The other fields are surfaced as hints
 * to the user without binding them yet — a stub we'll wire to runtime
 * config in a follow-up.
 *
 * We do *not* touch the runtime's own config file from here. The runtime
 * is the source of truth for things like the listen port; this file is the
 * UI's private preferences. The shape lives in
 * `app/lib/controller-settings.ts` so the diagnostics collector can share
 * it.
 */

export async function GET() {
  if (isPublic) {
    return NextResponse.json(
      { ok: false, message: "Settings are not exposed on the public deployment." },
      { status: 403 },
    );
  }
  const settings = await readControllerSettings();
  return NextResponse.json({ ok: true, settings });
}

export async function POST(req: Request) {
  if (isPublic) {
    return NextResponse.json(
      { ok: false, message: "Settings are not exposed on the public deployment." },
      { status: 403 },
    );
  }
  let patch: Partial<ControllerSettings>;
  try {
    patch = (await req.json()) as Partial<ControllerSettings>;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Body must be JSON." },
      { status: 400 },
    );
  }
  const current = await readControllerSettings();
  const next: ControllerSettings = {
    defaultModel:
      typeof patch.defaultModel === "string" || patch.defaultModel === null
        ? patch.defaultModel
        : current.defaultModel,
    backend: isBackend(patch.backend) ? patch.backend : current.backend,
    publicOrigins: Array.isArray(patch.publicOrigins)
      ? patch.publicOrigins
          .map((o) => (typeof o === "string" ? o.trim() : ""))
          .filter((o) => o.length > 0)
      : current.publicOrigins,
    keepMeshRunningAfterQuit:
      typeof patch.keepMeshRunningAfterQuit === "boolean"
        ? patch.keepMeshRunningAfterQuit
        : current.keepMeshRunningAfterQuit,
    shareDiagnostics:
      typeof patch.shareDiagnostics === "boolean"
        ? patch.shareDiagnostics
        : current.shareDiagnostics,
    // installId is never set from the UI — preserve whatever exists (or
    // stays null until the diagnostics collector mints one). Fall back to
    // the default so a hand-edited file with a bogus type self-heals.
    installId:
      typeof current.installId === "string"
        ? current.installId
        : DEFAULT_CONTROLLER_SETTINGS.installId,
  };
  await writeControllerSettings(next);
  return NextResponse.json({ ok: true, settings: next });
}
