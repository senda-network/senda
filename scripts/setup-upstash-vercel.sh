#!/usr/bin/env bash
# Provision Upstash Redis on Vercel and pull env vars into .env.local.
#
# Prerequisite: accept Upstash marketplace terms once in the Vercel dashboard
# (Storage → Marketplace → Upstash → Install, or complete the CLI prompt).
#
#   ./scripts/setup-upstash-vercel.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v vercel >/dev/null 2>&1; then
  echo "[setup-upstash] install Vercel CLI: npm i -g vercel" >&2
  exit 1
fi

echo "[setup-upstash] Linking Upstash for Redis (select 'Upstash for Redis', confirm link)…"
printf '\x1b[B\x1b[B\nY\nY\n' | vercel integration add upstash || true

echo "[setup-upstash] Resources:"
vercel integration list

echo "[setup-upstash] Pulling env (production + development)…"
vercel env pull .env.local --yes

if ! grep -qE 'UPSTASH_REDIS_REST_URL|KV_REST_API_URL' .env.local 2>/dev/null; then
  echo "[setup-upstash] No Redis URL in .env.local yet." >&2
  echo "  Open https://vercel.com/dashboard → closedmesh → Storage → Upstash → Redis" >&2
  echo "  Create a database, link to project, then re-run: vercel env pull .env.local --yes" >&2
  exit 1
fi

if ! grep -q '^CRON_SECRET=' .env.local 2>/dev/null; then
  secret="$(openssl rand -base64 32 | tr -d '\n')"
  echo "[setup-upstash] Adding CRON_SECRET to Vercel production…"
  printf '%s' "$secret" | vercel env add CRON_SECRET production
  vercel env pull .env.local --yes
fi

echo "[setup-upstash] Done. Deploy with: vercel --prod"
