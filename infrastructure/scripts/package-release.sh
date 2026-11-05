#!/usr/bin/env bash
# Assemble the Node.js part of a release from already-built apps (run from the repo root, in CI).
#   bash infrastructure/scripts/package-release.sh node <out-dir>
# Produces:
#   <out>/api           dist/, dist-seed/, prisma/ (schema + migrations) and production node_modules
#   <out>/operator-web  Next.js standalone server (mounted at /operator)
#   <out>/booking-web   Next.js standalone server (mounted at /)
set -euo pipefail
[ "${1:-}" = node ] || { echo "usage: $0 node <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$2" && cd "$2" && pwd)
ROOT=$(pwd)

echo "→ API (production dependencies only)"
rm -rf "$OUT/api"
pnpm --filter @park2all/api deploy --prod --legacy "$OUT/api"
(
  cd "$OUT/api"
  ./node_modules/.bin/prisma generate
  rm -rf src test jest.config.js nest-cli.json tsconfig*.json tsconfig.tsbuildinfo
  test -f dist/main.js && test -f dist-seed/prisma/seed.js
)

for app in operator-web booking-web; do
  echo "→ $app (Next.js standalone)"
  SRC="$ROOT/apps/$app"
  DEST="$OUT/$app"
  rm -rf "$DEST"
  cp -R "$SRC/.next/standalone" "$DEST"
  # Standalone output omits static assets and public/; the server expects them beside server.js.
  mkdir -p "$DEST/apps/$app/.next"
  cp -R "$SRC/.next/static" "$DEST/apps/$app/.next/static"
  [ -d "$SRC/public" ] && cp -R "$SRC/public" "$DEST/apps/$app/public"
  test -f "$DEST/apps/$app/server.js"
done

du -sh "$OUT"/*
