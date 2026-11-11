#!/usr/bin/env bash
# Applies Prisma migrations against Neon's DIRECT (non-pooled) URL. Run from CI before releasing.
#   DIRECT_DATABASE_URL=postgres://...neon.tech/db?sslmode=require pnpm db:deploy
set -euo pipefail
: "${DIRECT_DATABASE_URL:?DIRECT_DATABASE_URL (Neon direct connection string) is required}"
export DATABASE_URL="$DIRECT_DATABASE_URL"
pnpm --filter @app/db exec qr-prisma migrate deploy
