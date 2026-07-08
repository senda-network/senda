import { NextResponse } from "next/server";
import { findSendaBin, isPublic, runSenda } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Install the runtime as a launchd / systemd-user / Scheduled Task service.
 * Used by the "Start at login" toggle on the Settings page.
 */
export async function POST() {
  if (isPublic) {
    return NextResponse.json(
      { ok: false, message: "Control panel is disabled on the public deployment." },
      { status: 403 },
    );
  }
  const bin = await findSendaBin();
  if (!bin) {
    return NextResponse.json(
      { ok: false, message: "senda binary not found." },
      { status: 404 },
    );
  }
  const result = await runSenda(bin, ["service", "install"], 15000);
  return NextResponse.json({
    ok: result.ok,
    message: result.ok
      ? "Senda will start automatically when you log in."
      : (result.stderr || result.stdout || "service install failed"),
  });
}
