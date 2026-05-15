---
name: closedmesh-infra
description: ClosedMesh infrastructure map, deploy flows, and environment variables. Use whenever deploying, releasing, or debugging any part of the ClosedMesh stack — website, desktop app, runtime, or entry node.
---

# ClosedMesh Infrastructure

## Repository access policy — READ FIRST

**The ONLY GitHub repositories you may interact with are the ones under the `closedmesh/` organization.** No exceptions. This applies to every tool: `git`, `gh`, the GitHub MCP, `curl` to api.github.com — anything.

The only two allowed repos:

| Repo | What it is | Local path |
|------|-----------|-----------|
| `closedmesh/closedmesh` | Next.js public site + Tauri desktop app | `/Users/al/apps/closedmesh` |
| `closedmesh/closedmesh-llm` | Rust runtime binary + Docker entry node | `/Users/al/apps/closedmesh-llm` |

### Do NOT touch (ever — not read, not fetch, not query)

- `Mesh-LLM/mesh-llm` — historical public upstream of `closedmesh-llm`. Any `gh` auto-resolution to this repo is a bug, not a feature.
- `michaelneale/mesh-llm` — transferred/renamed predecessor of the above; same rule applies.
- Any other fork, mirror, or upstream you discover in git remotes or config.

### Rules for `gh` and other GitHub tooling

1. **Always scope `gh` explicitly:** pass `-R closedmesh/closedmesh` or `-R closedmesh/closedmesh-llm` on every invocation. Never rely on `gh`'s auto-resolution — the `closedmesh-llm` checkout was previously configured with an `upstream` remote that made `gh` resolve to `Mesh-LLM/mesh-llm` silently.
2. **Local `.git/config` is locked down:** `/Users/al/apps/closedmesh-llm/.git/config` has `upstream` remote removed and `gh-resolved = base` pinned to `origin` (= `closedmesh/closedmesh-llm`). Do not add `upstream` or any non-`closedmesh/` remote back.
3. **Before any `gh` call, confirm the target repo** either by `-R` flag or by reading the git config. If you can't confirm, don't run the command.
4. **Subagents inherit this rule.** When dispatching a shell/browser subagent for git or `gh` work, include the repo-access policy in the prompt and require explicit `-R closedmesh/<repo>` scoping.

---

## Services and where they run

| Service | Platform | URL |
|---------|----------|-----|
| Public website + API | **Vercel** (`closedmesh` project, `0xaliks-projects`) | https://closedmesh.com |
| Entry node (mesh gateway) | **AWS Lightsail** (`closedmesh-entry` instance) | https://mesh.closedmesh.com |
| Reverse proxy on Lightsail | **Caddy** (host, not Docker) | port 443 → container port 9337 |
| Mesh entry node process | **Docker** container `mesh-entry` on Lightsail | image `mesh-entry:latest` |

## Debugging this user's Mac is debugging YOUR workspace — DO NOT delegate

**The user runs the desktop app on this same Mac. Your `Shell` tool runs on this same Mac.** When debugging the local desktop runtime, llama-server, rpc-server, or anything that emits files under `~/.closedmesh/`, **YOU read them yourself.** Never paste a `tail`/`grep`/`cat` snippet and ask the user to run it and paste back — that doubles latency, breaks flow, and (correctly) infuriates them.

Specifically, you have direct access to:

- `~/.closedmesh/runtime/<pid>/logs/llama-server-<port>.log` — per-llama-server stdout+stderr; contains launch argv, the Metal/CUDA fit decisions, and the actual `Compute error` / OOM details when inference fails.
- `~/.closedmesh/runtime/<pid>/logs/rpc-server-<port>.log` — per-rpc-server stdout+stderr; check this when a pipeline split fails because the worker side isn't responding.
- `~/.closedmesh/runtime/<pid>/pidfiles/*.json` — full argv snippet, child pid, owner pid for every spawned subprocess.
- `~/.cache/closedmesh/splits/<model>/<n>-nodes/node-*.gguf` — per-node split shards, sized by the planner.
- `~/.cache/closedmesh/...` and `~/Library/Application Support/closedmesh/...` — caches and config.
- `ps -axo pid,etime,command | grep closedmesh` — full argv of the currently running runtime, llama-server, and rpc-server processes.
- `~/Library/LaunchAgents/com.closedmesh.*.plist` — the launchd plist that autostarts the runtime; this is where service-level CLI flags live (e.g. `--max-vram`).

The single exception: when the user is reporting visible behavior in the desktop UI ("the Models page shows X, the dot is yellow"), trust their description rather than re-deriving it from filesystem state. That is faster.

### Heads-up: editing the launchd plist by hand is fragile

Manual edits to `~/Library/LaunchAgents/dev.closedmesh.closedmesh.plist` get reverted by the desktop GUI's self-heal loop in `desktop/src/mesh.rs` (the `Rewrites ~/Library/LaunchAgents/dev.closedmesh.closedmesh.plist` function), and `launchctl bootout` returns `5: Input/output error` if any session has an open reference. The reliable sequence to apply a plist override is:

1. `pkill -9 -f /Applications/ClosedMesh.app/Contents/MacOS/closedmesh` — kill the GUI app first; otherwise it rewrites the plist mid-edit.
2. `launchctl bootout gui/$(id -u)/dev.closedmesh.closedmesh` — accept that this may fail with EIO, just inspect `launchctl list | grep closedmesh` to see if the agent is still loaded.
3. If still loaded, `kill -TERM <pid>` the running `closedmesh serve` — KeepAlive fails to respawn (because we just booted out) and the agent unloads.
4. Edit the plist, then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.closedmesh.closedmesh.plist`.
5. Verify with `ps -axo command | grep "/closedmesh serve"` that the new flag is in argv.

For one-off llama-server-level fixes (per-launch CLI flag overrides), the saner path is a shell-script shim at `~/.local/bin/llama-server-metal` (rename the real binary to `.real` and exec through the shim). Survives the desktop GUI's self-heal because the GUI doesn't touch `~/.local/bin/`. **But** the auto-upgrader replaces `~/.local/bin/llama-server-metal` on every runtime release, so any shim is a strictly temporary workaround until the underlying issue is fixed in the runtime.

**Same rule applies to the entry node:** SSH yourself, don't ask. You have the key (`~/.ssh/closedmesh-deploy_ed25519`) and the host (`ubuntu@3.210.30.58`).

---

## Deploy flows

### Website (closedmesh.com)

> **Vercel does NOT auto-deploy on git push.** Always run manually.

```bash
cd /Users/al/apps/closedmesh
vercel --prod
```

Check existing deployments: `vercel ls`

### Desktop app (Tauri)

1. Bump version in **two files** (must match):
   - `desktop/Cargo.toml` → `version = "X.Y.Z"`
   - `desktop/tauri.conf.json` → `"version": "X.Y.Z"`
2. Commit and push to `main` on `closedmesh/closedmesh`
3. Push a `vX.Y.Z` **tag** — this is what triggers the build, NOT the branch push:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
4. GitHub Actions (`desktop-release.yml`) builds `.dmg` / installers (~10 min)

Release policy: ship straight from `main` with real versions. Do not use
`desktop-v*`, candidate, or throwaway prerelease app tags; if an unlaunched
version needs correction, fix forward and rebuild the same real release version
or bump to the next real version.

Current version: check `desktop/Cargo.toml`.

### Runtime binary (closedmesh-llm)

**Auto-update behavior** (added in desktop v0.1.40): the desktop app now self-upgrades the runtime binary in the background. On launch, after a 30 s settle delay, `spawn_runtime_upgrade_loop` (in `desktop/src/mesh.rs`) probes `https://github.com/closedmesh/closedmesh-llm/releases/latest` (no-redirect GET, reads `Location` header → tag → version), and if installed < latest it downloads the asset, verifies it via `--version`, stops the service, atomically renames the binary, and restarts. Re-checks every 6 h. Silent — no UI prompt, because runtime fixes are the kind of thing users need but won't manually update.

This means **shipping a runtime release is the actual fix-distribution mechanism for installed users** — within 6 h of launch they get it. Desktop app updates are still click-through-installer because we lack signing infra.

**Upgrade-state surface for the dashboard** (added in desktop v0.1.83): the silent auto-upgrade was historically invisible from the dashboard — there was no way to tell from the UI whether the runtime was updating, whether a check had failed, or what version was even installed. The loop now writes a small JSON state file `runtime-upgrade-state.json` into `default_log_dir()` (`~/Library/Logs/closedmesh/` on macOS, `~/.local/state/closedmesh/` on Linux, `%APPDATA%\closedmesh\logs\` on Windows) after every check outcome, with `{ installedVersion, latestVersion, checkedAt, lastOutcome, checking, lastUpgrade, lastError }`. Consumed by `app/api/control/runtime-upgrade/route.ts` (GET) and rendered on the dashboard's "This machine" card. The same endpoint accepts POST to drop a `runtime-upgrade-request.flag` sibling file the Rust loop polls every 5 s while sleeping — that's how the dashboard's "Check for update now" button skips the 6 h auto-cadence. The basenames must match between the Rust shell (`RUNTIME_UPGRADE_STATE_BASENAME` / `RUNTIME_UPGRADE_REQUEST_BASENAME` in `mesh.rs`) and the Node route (`STATE_FILE_BASENAME` / `REQUEST_FILE_BASENAME` in the route module) — change one without the other and the dashboard silently degrades to "no upgrade state".

**`lastError` in the state file** (added in desktop v0.1.84): every `UpgradeOutcome::Failed` branch in `try_upgrade_runtime` now carries a short human-readable `error: String` that gets written to `runtime-upgrade-state.json` as `lastError` and rendered inline under the runtime row on the dashboard. Without this we discovered the failure mode — Windows runtime asset defaulted to `vulkan` but the closedmesh-llm release pipeline only publishes `closedmesh-windows-x86_64-cuda.zip`, causing every Windows auto-upgrade since 0.1.40 to silently 404 — only by getting a user to share desktop.log. With `lastError` the dashboard says `GitHub returned HTTP 404 for closedmesh-windows-x86_64-vulkan.zip ...` directly. The field is cleared (set to `null`) on the next `Upgraded` or `UpToDate` outcome so a recovered network blip doesn't leave a stale error pill on the dashboard forever. **Windows asset selection**: `runtime_asset_name()` defaults to `cuda` on Windows because that's the only flavor the release pipeline currently builds; revisit when `closedmesh-windows-x86_64-{cpu,vulkan}.zip` start showing up in `/releases/latest`. `CLOSEDMESH_BACKEND` env var still wins when set explicitly.

Releases are triggered by **`workflow_dispatch`** — NOT a tag push (the workflow creates the tag itself).

```bash
# Trigger via gh CLI (preferred):
gh -R closedmesh/closedmesh-llm workflow run release.yml \
  -f version=0.X.Y \
  -f prerelease=false \
  -f skip_gpu_bundles=false \
  -f target_branch=main

# Or via GitHub UI: Actions → Release → Run workflow
```

The workflow's `prepare_release` job bumps all `Cargo.toml` versions, commits to `main`, creates the tag, then build jobs run in parallel (~2.5h for Linux CUDA), and finally `Publish GitHub release` uploads the assets.

Release policy: always use real `vX.Y.Z` runtime releases from `main` with
`prerelease=false`. Do not use `*-pre`, prerelease, or candidate runtime
versions unless Al explicitly overrides this rule.

GitHub Actions (`release.yml`) uploads assets named `closedmesh-{os}-{arch}.tar.gz` (stable alias, always points to latest) and `closedmesh-v{version}-{os}-{arch}.tar.gz` (versioned, pinned to that release).

### Entry node (Lightsail)

The container is **owned by a systemd unit** on the host, not started by hand. The unit also bypasses the image's `entrypoint.sh` (`--entrypoint closedmesh`) and passes the closedmesh CLI args directly. **Editing the docker run by hand will get reverted within `RestartSec=10` seconds when systemd respawns it** — always edit the unit file.

SSH:

```bash
ssh -i ~/.ssh/closedmesh-deploy_ed25519 ubuntu@3.210.30.58
```

(AWS Lightsail, region `us-east-1`, instance name `closedmesh-mesh-entry`. Find it any time with `aws lightsail get-instances --region us-east-1`.)

To deploy a new image / change config:

```bash
# 1. (optional) Pull the new image so the next restart picks it up
sudo docker pull ghcr.io/closedmesh/closedmesh-llm/mesh-entry:latest

# 2. Edit the systemd unit if any flags need changing
sudoedit /etc/systemd/system/closedmesh-entry.service

# 3. Apply
sudo systemctl daemon-reload
sudo systemctl restart closedmesh-entry.service

# 4. Tail logs / verify it came up
journalctl -u closedmesh-entry -f
docker logs mesh-entry 2>&1 | grep -E "Invite created|API ready|ERR"
```

The unit (current contents):

```ini
[Unit]
Description=ClosedMesh Entry Node
After=docker.service network-online.target
Requires=docker.service

[Service]
Restart=always
RestartSec=10
ExecStartPre=-/usr/bin/docker stop mesh-entry
ExecStartPre=-/usr/bin/docker rm mesh-entry
# DO NOT add --auto or --publish here. See "Privacy lockdown" below.
ExecStart=/usr/bin/docker run \
  --network=host \
  --name mesh-entry \
  --volume /opt/closedmesh-data:/root/.closedmesh \
  --entrypoint closedmesh \
  ghcr.io/closedmesh/closedmesh-llm/mesh-entry:latest \
  client \
    --port 9337 \
    --console 3131 \
    --listen-all \
    --mesh-name closedmesh \
    --bind-port 42140
ExecStop=/usr/bin/docker stop mesh-entry

Environment="MESH_AUTH_TOKEN=<bearer token; matches Vercel CLOSEDMESH_RUNTIME_TOKEN>"
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

A backup copy of the previous unit lives at `/etc/systemd/system/closedmesh-entry.service.bak.<unix-timestamp>` (created on every edit, so you can `diff` and roll back).

**Privacy lockdown (May 5 2026 — read this before touching the unit)**

The entry node previously ran with `--auto --publish --mesh-name closedmesh`. That advertised our existence on the global `mesh-llm` Nostr channel (the runtime's d-tag is still the literal `"mesh-llm"` — see Phase C below) and made our `--auto` mode try to merge into other meshes named `closedmesh`. The result: ~17 strangers from the upstream `Mesh-LLM/mesh-llm` community pool were continuously connected through us, visible on closedmesh.com/status, and routing chat traffic. Removing the two flags + a one-time iroh identity rotation (which the runtime does for free on any public→private transition) cleared them out. **Do not add `--auto` or `--publish` back until Phase C ships** (private d-tag + private kind in `closedmesh-llm`). Until then, real users find this entry exclusively via the embedded `FALLBACK_JOIN_TOKEN` in `desktop/src/mesh.rs` plus the live `--join-url https://mesh.closedmesh.com/api/status` path.

**Critical infrastructure invariants**:

- `MESH_BIND_PORT` (currently passed as `--bind-port 42140`) keeps iroh on a fixed UDP port. Lightsail firewall has 40000–45000 open; random ports break P2P.
- `--volume /opt/closedmesh-data:/root/.closedmesh` is mounted but in practice contains only `last-mesh` (cached mesh-id, 16 bytes) and an empty `run/plugins/` directory. The runtime currently does **not** persist its iroh node keypair anywhere on disk, which means **the entry rotates iroh identity on every container restart** — `node_id` and the address half of `FALLBACK_JOIN_TOKEN` change each time. Mesh-id (`bbb454985b6e0279`) is stable because of `last-mesh`. Practical consequences: (a) `FALLBACK_JOIN_TOKEN` in `desktop/src/mesh.rs` goes stale on every entry bounce — update it from `curl -s https://mesh.closedmesh.com/api/status | jq -r .token` whenever you restart the entry, or accept that desktops fall back to the live `--join-url https://mesh.closedmesh.com/api/status` path. (b) **Running desktop runtimes do not auto-rediscover** when the entry's id rotates — they keep dialing the dead `EndpointId` until the user quits and reopens the desktop app, which re-runs the join-url fetch. So any entry restart effectively requires every active contributor to bounce their app.
- The container does **not** run Caddy. Caddy runs on the host (`systemctl status caddy`, config at `/etc/caddy/Caddyfile`) and reverse-proxies `:443 → 127.0.0.1:9337` (`/v1/*`) and `:443 → 127.0.0.1:3131` (`/api/*`), gating everything except `/v1/models` and `/api/status` on `Bearer {$MESH_AUTH_TOKEN}`. The Caddy env is set via `/etc/systemd/system/caddy.service.d/env.conf`.

---

## Environment variables

### Vercel (closedmesh.com)

| Variable | Value |
|----------|-------|
| `CLOSEDMESH_RUNTIME_URL` | `https://mesh.closedmesh.com/v1` |
| `CLOSEDMESH_ADMIN_URL` | `https://mesh.closedmesh.com` |
| `CLOSEDMESH_RUNTIME_TOKEN` | Bearer token (same as `MESH_AUTH_TOKEN` on Lightsail) |

> Set via `vercel env add VAR_NAME production`. **No trailing newlines** — Vercel has shipped env values with literal `\n` before, breaking URLs. Always trim when adding.

### GitHub Actions secrets (closedmesh repo)

| Secret | Used by |
|--------|---------|
| `CLOSEDMESH_RUNTIME_TOKEN` | `desktop-release.yml` — baked into desktop binary at build time |

### Lightsail Docker container

| Variable | Purpose |
|----------|---------|
| `MESH_AUTH_TOKEN` | Bearer token Caddy validates on all API requests |
| `MESH_BIND_PORT` | Fixed iroh QUIC port (must be 40000-45000) |
| `INTERNAL_PORT` | closedmesh API port inside container (9337) |
| `CONSOLE_PORT` | Admin console port (3131) |
| `MESH_PUBLISH` | Set `true` so entry node advertises itself to Nostr |

---

## Key files

| File | Purpose |
|------|---------|
| `desktop/src/mesh.rs` | `FALLBACK_JOIN_TOKEN` — update when entry node identity changes |
| `desktop/Cargo.toml` + `desktop/tauri.conf.json` | App version (must stay in sync) |
| `app/api/status/route.ts` | Public `/api/status` — aggregates mesh node + model data |
| `app/api/control/runtime-upgrade/route.ts` | Reads/writes runtime auto-upgrade state shared with the Rust shell |
| `app/components/MeshLiveStatus.tsx` | Header status pill → links to `/status` |
| `app/(public)/status/page.tsx` | Live mesh status page |
| `closedmesh-llm/docker/entrypoint.sh` | Docker container startup, reads all env vars |
| `closedmesh-llm/docker/Caddyfile` | Auth-gated Caddy config for entry node |

---

## Common gotchas

- **Vercel does not auto-deploy.** Always run `vercel --prod` after pushing.
- **Version bump requires two files**: `Cargo.toml` AND `tauri.conf.json` — they must match or the build fails.
- **Release versions are real mainline versions.** Desktop app tags are `vX.Y.Z`, not `desktop-v*`; runtime releases use `prerelease=false`, not `*-pre` or candidate versions.
- **Entry node container is owned by `closedmesh-entry.service`**, not by hand. `docker run`/`docker stop`/`docker rm` will be undone within ~10 s. Always edit the systemd unit and `systemctl restart`.
- **Never put `--auto` or `--publish` back on the entry node** until the Nostr d-tag is privatized in `closedmesh-llm` (Phase C). Both flags caused the May 2026 incident where the entry silently joined the upstream `mesh-llm` community pool.
- **Entry node uses a fixed iroh port** (`--bind-port 42140`). If the unit is edited without it, iroh picks a random port that is likely blocked by the Lightsail firewall, breaking P2P connections and causing `3.210.30.58:0` in the join token.
- **`FALLBACK_JOIN_TOKEN` in `mesh.rs`** must be updated whenever the entry node container's iroh identity rotates. Triggers: wiping `/opt/closedmesh-data`, OR a public→private / private→public flip (the runtime auto-rotates in this case — see logs for `Previous run was public — rotating identity`).
- **Vercel env vars must have no trailing newlines.** Remove and re-add if URLs look broken (`mesh.closedmesh.com\n` is invalid).
- **Asset names are `closedmesh-{os}-{arch}.tar.gz`**, not `mesh-llm-*`. Desktop app `mesh.rs` expects exactly this pattern for auto-update.
- **`closedmesh-llm` CI runs `xtask repo-consistency`** — if asset names, fixture JSON, `RELEASE.md`, or `install.sh` disagree, CI fails before building.
