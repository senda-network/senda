import { NextResponse } from "next/server";
import { findSendaBin, isPublic, runSenda } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const result = await runSenda(bin, ["service", "stop"]);
  return NextResponse.json({
    ok: result.ok,
    message: result.ok
      ? "Senda stopped."
      : (result.stderr || result.stdout || "stop failed"),
    output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
  });
}
