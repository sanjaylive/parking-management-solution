#!/usr/bin/env bash
# Runs ON THE VPS (as the deploy user). Called by GitHub Actions:
#   bash remote-release.sh /tmp/park2all-<sha>.tgz <sha>
# Layout:
#   /opt/park2all/releases/<sha>/   unpacked release (api, operator-web, booking-web, web/{staff,app}, infrastructure)
#   /opt/park2all/shared/api.env    production secrets (created once by vps-setup.sh, never in git)
#   /opt/park2all/current           symlink → active release
# Steps: unpack → link env → migrate DB → switch symlink → reload PM2 → health-check → roll back on failure.
set -euo pipefail

TARBALL=${1:?tarball path}
SHA=${2:?release sha}
BASE=${PARK2ALL_HOME:-/opt/park2all}
REL="$BASE/releases/$SHA"
KEEP=${KEEP_RELEASES:-5}
API_PORT=${API_PORT:-4100}

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$BASE/shared/api.env" ] || die "$BASE/shared/api.env is missing. Run infrastructure/scripts/vps-setup.sh first."
command -v pm2 >/dev/null || die "pm2 not installed (run vps-setup.sh)"

log "Unpacking $SHA"
rm -rf "$REL" && mkdir -p "$REL"
tar -C "$REL" -xzf "$TARBALL"
rm -f "$TARBALL"
[ "$(cat "$REL/RELEASE")" = "$SHA" ] || die "release marker mismatch"
ln -sfn "$BASE/shared/api.env" "$REL/api/.env"

PREV=$(readlink "$BASE/current" 2>/dev/null || true)

log "Applying database migrations"
(
  cd "$REL/api"
  set -a; . "$BASE/shared/api.env"; set +a
  ./node_modules/.bin/prisma migrate deploy
)

activate() {
  ln -sfn "$1" "$BASE/current.tmp" && mv -Tf "$BASE/current.tmp" "$BASE/current"
  pm2 startOrReload "$BASE/current/infrastructure/pm2/ecosystem.config.cjs" --update-env
  pm2 save >/dev/null
}

healthy() {
  local i body
  for i in $(seq 1 30); do
    body=$(curl -fsS "http://127.0.0.1:$API_PORT/health" 2>/dev/null || true)
    if printf '%s' "$body" | grep -q "\"release\":\"$SHA\""; then
      curl -fsS -o /dev/null http://127.0.0.1:3101/operator/login \
        && curl -fsS -o /dev/null http://127.0.0.1:3104/ \
        && [ -f "$BASE/current/web/staff/index.html" ] && [ -f "$BASE/current/web/app/index.html" ] \
        && return 0
    fi
    sleep 2
  done
  return 1
}

log "Activating $SHA"
activate "$REL"

if healthy; then
  log "Healthy: $(curl -fsS http://127.0.0.1:$API_PORT/health)"
else
  pm2 logs --nostream --lines 40 park2all-api || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    log "Health check failed — rolling back to $(basename "$PREV")"
    activate "$PREV"
    rm -rf "$REL"   # keep failed builds out of the rollback window
    die "Deploy of $SHA failed and was rolled back. Note: its DB migrations (if any) remain applied."
  fi
  die "Deploy of $SHA failed health check and there is no previous release to roll back to."
fi

log "Pruning old releases (keeping $KEEP)"
cd "$BASE/releases"
ls -1t | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$BASE/releases/$old" = "$(readlink "$BASE/current")" ] || rm -rf "$old"
done
log "Done: https://${PUBLIC_HOST:-park.2all.co.in} is on $SHA"
