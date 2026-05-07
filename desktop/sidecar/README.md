# sidecar/ — bundled controller + Node.js runtime

This directory holds the two artefacts the Tauri shell embeds in each
platform installer (see [`../SIDECAR.md`](../SIDECAR.md) for the full
design):

```
sidecar/
├── controller/        ← Next.js standalone bundle (server.js + .next/ + public/)
└── binaries/
    ├── closedmesh-node-aarch64-apple-darwin
    ├── closedmesh-node-x86_64-unknown-linux-gnu
    └── closedmesh-node-x86_64-pc-windows-msvc.exe
```

The `closedmesh-` prefix is deliberate: starting in 0.1.69 the
bundled Node binary is shipped under a unique image name
(`closedmesh-node.exe` on Windows, `closedmesh-node` elsewhere) so
the installer's pre-install kill can terminate just *our* sidecar by
name without disturbing the user's other Node processes (Node dev
server, VS Code's extension host, Electron renderers). Tauri's
`bundle.externalBin` strips the `-<triple>` suffix and copies whatever
remains to the install dir, so our installed sidecar is named
`closedmesh-node(.exe)` on every platform.

Both are **generated**, not checked in (see `.gitignore`). They get
populated at build time by:

- `scripts/stage-controller.sh` — runs `next build` in the repo root,
  copies `.next/standalone/` + `.next/static/` + `public/` here.
- `scripts/fetch-node.sh` — downloads the official Node.js LTS binary
  for the current target triple (or `--target=...`), unpacks it, and
  drops the `node` executable here with the right name suffix that
  `bundle.externalBin` in `tauri.conf.json` expects.

Local dev: `desktop/scripts/build.sh` calls both. CI: each matrix job
in `desktop-release.yml` calls them with the right `--target`.

If you nuke the folder by accident, just rerun `desktop/scripts/build.sh`
— it's idempotent and only re-fetches what's missing.
