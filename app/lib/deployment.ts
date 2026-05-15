/**
 * Deployment-flag helpers shared across the web stack.
 *
 * Three layers used to ask "are we the public Vercel deployment?" with
 * three slightly different env-var lists:
 *
 * - `proxy.ts` (edge): `NEXT_PUBLIC_DEPLOYMENT`, `CLOSEDMESH_DEPLOYMENT`.
 * - `app/api/control/_lib.ts` (Node API runtime): the two above PLUS
 *   `FORGEMESH_DEPLOYMENT` as a legacy fallback from the rename.
 * - `app/lib/runtime-target.ts` (browser bundle): `NEXT_PUBLIC_DEPLOYMENT`
 *   PLUS `NEXT_PUBLIC_CLOSEDMESH_DEPLOYMENT` — and notably ignored by
 *   the other two.
 *
 * That skew let a misconfigured Vercel project set, say, only
 * `NEXT_PUBLIC_CLOSEDMESH_DEPLOYMENT=public` and end up with a public
 * site whose edge firewall and `/api/control/*` handlers disagreed
 * about whether to lock down. Channeling all three through this module
 * means flipping any one accepted name flips the deployment flag for
 * every layer that can legally see it.
 *
 * `.trim()` matches the pre-existing pattern: Vercel has historically
 * shipped env values with a literal trailing newline (`"public\n"`),
 * which silently turned the gate off.
 */

function flagSet(value: string | undefined): boolean {
  return (value ?? "").trim() === "public";
}

/**
 * Names the Next.js bundler will inline into the browser bundle. Only
 * `NEXT_PUBLIC_*` is reachable at runtime in the browser; using a
 * server-only var here would silently always be `undefined`.
 */
const CLIENT_FLAG_KEYS = [
  "NEXT_PUBLIC_DEPLOYMENT",
  "NEXT_PUBLIC_CLOSEDMESH_DEPLOYMENT",
] as const;

/**
 * Server-only fallback names. Combined with the client list these form
 * the canonical set of "this is the public deployment" signals.
 */
const SERVER_ONLY_FLAG_KEYS = [
  "CLOSEDMESH_DEPLOYMENT",
  "FORGEMESH_DEPLOYMENT",
] as const;

/**
 * The minimum env shape we read. Looser than `NodeJS.ProcessEnv` (which
 * mandates `NODE_ENV` and other fields under `strict`) so tests can pass
 * tiny `{ NEXT_PUBLIC_DEPLOYMENT: "public" }`-shaped fixtures.
 */
export type DeploymentEnv = Record<string, string | undefined>;

/**
 * Browser-safe predicate. Reads only `NEXT_PUBLIC_*` env vars so it
 * works inside the client bundle. Use this from React components and
 * other code that ships to the browser.
 */
export function isPublicDeploymentClient(
  env: DeploymentEnv = process.env,
): boolean {
  return CLIENT_FLAG_KEYS.some((key) => flagSet(env[key]));
}

/**
 * Server-side predicate. Reads every accepted env name. Use this from
 * route handlers, the edge proxy, and any code that runs only on the
 * server (Node or Edge runtime).
 */
export function isPublicDeploymentServer(
  env: DeploymentEnv = process.env,
): boolean {
  if (isPublicDeploymentClient(env)) return true;
  return SERVER_ONLY_FLAG_KEYS.some((key) => flagSet(env[key]));
}
