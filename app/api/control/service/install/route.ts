import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { findSendaBin, isPublic, runSenda } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Install the runtime as a login autostart unit (LaunchAgent /
 * systemd-user / Scheduled Task). The runtime CLI has no
 * `service install` subcommand — we re-run the platform installer with
 * the service flag, then start the unit.
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

  const scriptName =
    process.platform === "win32" ? "install.ps1" : "install.sh";
  const scriptPath = path.join(process.cwd(), "public", scriptName);
  try {
    await fs.access(scriptPath);
  } catch {
    return NextResponse.json(
      { ok: false, message: `${scriptName} not found — can't register autostart.` },
      { status: 500 },
    );
  }

  const ok = await new Promise<boolean>((resolve) => {
    let cmd: string;
    let args: string[];
    if (process.platform === "win32") {
      cmd = "powershell";
      args = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Service",
      ];
    } else {
      cmd = "bash";
      args = [scriptPath, "--service"];
    }
    const child = spawn(cmd, args, {
      env: process.env,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });

  if (!ok) {
    return NextResponse.json({
      ok: false,
      message: "Failed to register the login autostart unit.",
    });
  }

  const start = await runSenda(bin, ["service", "start"], 15000);
  return NextResponse.json({
    ok: start.ok,
    message: start.ok
      ? "Senda will start automatically when you log in."
      : (start.stderr || start.stdout || "service start failed"),
  });
}
