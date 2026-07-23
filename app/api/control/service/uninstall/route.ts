import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isPublic, runSenda, findSendaBin } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Remove the launchd / systemd-user / Scheduled Task unit so Senda
 * stops auto-starting at login. The runtime keeps working for the current
 * session — this just unhooks autostart.
 *
 * Implemented with direct OS ops (the runtime CLI has no
 * `service uninstall` subcommand).
 */
export async function POST() {
  if (isPublic) {
    return NextResponse.json(
      { ok: false, message: "Control panel is disabled on the public deployment." },
      { status: 403 },
    );
  }

  const platform = process.platform;
  try {
    if (platform === "darwin") {
      const plist = path.join(
        homedir(),
        "Library",
        "LaunchAgents",
        "network.senda.runtime.plist",
      );
      // Best-effort bootout; ignore failures when already unloaded.
      const bin = await findSendaBin();
      if (bin) {
        await runSenda(bin, ["service", "stop"], 10000);
      }
      try {
        await fs.unlink(plist);
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code !== "ENOENT") throw e;
      }
      return NextResponse.json({
        ok: true,
        message: "Senda won't start automatically anymore.",
      });
    }

    if (platform === "linux") {
      const bin = await findSendaBin();
      if (bin) {
        await runSenda(bin, ["service", "stop"], 10000);
      }
      // `systemctl --user disable` + remove unit file.
      const { spawn } = await import("node:child_process");
      await new Promise<void>((resolve) => {
        const child = spawn(
          "systemctl",
          ["--user", "disable", "--now", "senda.service"],
          { stdio: "ignore" },
        );
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
      const unit = path.join(
        homedir(),
        ".config",
        "systemd",
        "user",
        "senda.service",
      );
      try {
        await fs.unlink(unit);
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code !== "ENOENT") throw e;
      }
      return NextResponse.json({
        ok: true,
        message: "Senda won't start automatically anymore.",
      });
    }

    if (platform === "win32") {
      const { spawn } = await import("node:child_process");
      await new Promise<void>((resolve) => {
        const child = spawn(
          "schtasks",
          ["/Delete", "/TN", "Senda", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
      return NextResponse.json({
        ok: true,
        message: "Senda won't start automatically anymore.",
      });
    }

    return NextResponse.json(
      { ok: false, message: `Unsupported platform: ${platform}` },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: e instanceof Error ? e.message : "service uninstall failed",
      },
      { status: 500 },
    );
  }
}
