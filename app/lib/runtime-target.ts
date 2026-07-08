/**
 * Where the browser should send `/api/*` calls.
 *
 * The chat surface is identical between senda.network and the bundled
 * controller in the desktop app. In both cases the page calls its own
 * same-origin Next.js routes (`/api/chat`, `/api/status`, etc.). The
 * difference lives entirely on the server side:
 *
 * - On senda.network the Vercel function proxies to the public mesh
 *   entry point (`SENDA_RUNTIME_URL`).
 * - In the .app the bundled controller proxies to the local senda-llm
 *   runtime on `127.0.0.1:9337`.
 *
 * The browser never reaches into the visitor's machine. There is no
 * cross-origin call from the public site to localhost — that pattern
 * triggered the browser's private-network-access prompt and confused
 * what's a "your machine" feature versus a "the mesh" feature.
 */

// Browser-safe wrapper around the shared deployment-flag helper. Only
// `NEXT_PUBLIC_*` env vars are inlined into the client bundle, so the
// client-only variant is the right call here — pulling in the server
// variant would silently always read `undefined` for the legacy
// `SENDA_DEPLOYMENT` / `FORGEMESH_DEPLOYMENT` names.
import { isPublicDeploymentClient } from "./deployment";

const PUBLIC_DEPLOYMENT_BUILD = isPublicDeploymentClient();

export function isPublicDeployment(): boolean {
  return PUBLIC_DEPLOYMENT_BUILD;
}

/**
 * Same-origin path. Kept as a function for forward-compatibility with any
 * future env-driven override (e.g. pointing the .app at a remote test
 * controller for dev), but the public website never sends fetches outside
 * its own origin.
 */
export function apiUrl(path: `/${string}`): string {
  return path;
}
