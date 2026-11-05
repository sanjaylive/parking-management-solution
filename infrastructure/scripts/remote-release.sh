#!/usr/bin/env bash
# Runs ON THE VPS as the deploy user (needs the docker group; sudo only on first run to create /opt/park2all).
# Called by GitHub Actions:
#   bash remote-release.sh /tmp/park2all-<sha>.tgz /tmp/park2all-images-<sha>.tgz <sha>
# Layout:
#   /opt/park2all/releases/<sha>/   compose.yml, Caddy site block, scripts (no app code: that lives in the images)
#   /opt/park2all/.env.production   production secrets (generated on the first deploy, mode 600, never in git)
#   /opt/park2all/current           symlink → active release
# Steps: load images → unpack → migrate DB → start stack → health-check (roll back on failure)
#        → make sure the edge Caddy serves park.2all.co.in → prune old releases and images.
set -euo pipefail

TARBALL=${1:?release tarball}
IMAGES=${2:?images tarball}
SHA=${3:?release sha}
BASE=${PARK2ALL_HOME:-/opt/park2all}
REL="$BASE/releases/$SHA"
ENV_FILE="$BASE/.env.production"
DOMAIN=${DOMAIN:-park.2all.co.in}
EDGE_CONTAINER=${EDGE_CONTAINER:-pay2all-caddy-1}
KEEP=${KEEP_RELEASES:-3}

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

docker info >/dev/null 2>&1 || die "$(id -un) cannot use Docker (add it to the docker group)"
EDGE_NETWORK=${EDGE_NETWORK:-$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$EDGE_CONTAINER" 2>/dev/null | awk '{print $1}')}
[ -n "$EDGE_NETWORK" ] || die "edge proxy container $EDGE_CONTAINER not found"

if [ ! -d "$BASE" ]; then
  log "Creating $BASE"
  sudo -n install -d -o "$(id -u)" -g "$(id -g)" -m 750 "$BASE" || die "cannot create $BASE (needs passwordless sudo once, or create it by hand)"
fi
mkdir -p "$BASE/releases"

if [ ! -f "$ENV_FILE" ]; then
  log "First deploy: generating $ENV_FILE with fresh secrets"
  rnd() { openssl rand -hex 32; }
  umask 077
  cat > "$ENV_FILE" <<ENV
# Park2All production settings. Generated $(date -u +%FT%TZ) by remote-release.sh. Stays on the server; never commit.
POSTGRES_PASSWORD=$(openssl rand -hex 24)
PUBLIC_URL=https://$DOMAIN
CORS_ORIGINS=https://$DOMAIN
JWT_ACCESS_SECRET=$(rnd)
JWT_REFRESH_SECRET=$(rnd)
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
QR_SIGNING_SECRET=$(rnd)
DEVICE_SECRET_ENCRYPTION_KEY=$(rnd)
PAYMENT_WEBHOOK_SECRET=$(rnd)
# No SMS or payment-gateway credentials yet, so this box runs as STAGING: OTPs are returned in API responses and
# payments go through the sandbox. Set real providers and remove ALLOW_SANDBOX_PROVIDERS before taking real customers.
OTP_PROVIDER=console
PAYMENT_PROVIDER=sandbox
ALLOW_SANDBOX_PROVIDERS=true
ENV
  umask 022
fi

log "Loading images"
gunzip -c "$IMAGES" | docker load
rm -f "$IMAGES"

log "Unpacking $SHA"
rm -rf "$REL" && mkdir -p "$REL"
tar -C "$REL" -xzf "$TARBALL"
rm -f "$TARBALL"
[ "$(cat "$REL/RELEASE")" = "$SHA" ] || die "release marker mismatch"

PREV=$(readlink "$BASE/current" 2>/dev/null || true)

compose() { # compose <release dir> <args…>
  local dir=$1; shift
  APP_RELEASE=$(basename "$dir") ENV_FILE="$ENV_FILE" EDGE_NETWORK="$EDGE_NETWORK" \
    docker compose -p park2all -f "$dir/infrastructure/docker/compose.yml" --env-file "$ENV_FILE" "$@"
}

log "Applying database migrations"
compose "$REL" run --rm migrate

log "Starting $SHA"
started() {
  compose "$1" up -d --remove-orphans --wait --wait-timeout 180 \
    && [ "$(compose "$1" exec -T park-api node -e "fetch('http://127.0.0.1:4100/health').then(r=>r.json()).then(j=>console.log(j.release))")" = "$(basename "$1")" ]
}
if started "$REL"; then
  ln -sfn "$REL" "$BASE/current.tmp" && mv -Tf "$BASE/current.tmp" "$BASE/current"
  log "Healthy: $(compose "$REL" exec -T park-api node -e "fetch('http://127.0.0.1:4100/health').then(r=>r.text()).then(console.log)")"
else
  compose "$REL" logs --tail 40 park-api park-operator park-booking || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    log "Health check failed — rolling back to $(basename "$PREV")"
    compose "$PREV" up -d --remove-orphans --wait --wait-timeout 180 || true
    rm -rf "$REL"
    die "Deploy of $SHA failed and was rolled back. Note: its DB migrations (if any) remain applied."
  fi
  die "Deploy of $SHA failed its health check and there is no previous release to roll back to."
fi

# The edge Caddy's Caddyfile is a single-file bind mount from the pay2all release; edit it in place (same inode)
# so the container sees the change. The block sits between BEGIN/END markers and is replaced, never duplicated.
log "Edge proxy: $DOMAIN"
CADDYFILE=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$EDGE_CONTAINER")
BLOCK="$REL/infrastructure/caddy/park2all.caddy"
if [ -z "$CADDYFILE" ] || [ ! -w "$CADDYFILE" ]; then
  log "WARNING: cannot edit the edge Caddyfile ($CADDYFILE); add $BLOCK to it by hand"
else
  CANDIDATE=$(mktemp)
  # Drop the old block and any trailing blank lines (so repeated deploys produce an identical file).
  awk '/^# BEGIN park2all/{skip=1}
       !skip { if ($0 == "") blank++; else { for (; blank > 0; blank--) print ""; print } }
       /^# END park2all/{skip=0}' "$CADDYFILE" > "$CANDIDATE"
  printf '\n' >> "$CANDIDATE" && cat "$BLOCK" >> "$CANDIDATE"
  if cmp -s "$CANDIDATE" "$CADDYFILE"; then
    log "Edge Caddyfile already up to date"
  elif docker exec -i "$EDGE_CONTAINER" sh -c 'cat > /tmp/park2all.Caddyfile && caddy validate --config /tmp/park2all.Caddyfile --adapter caddyfile' < "$CANDIDATE" >/dev/null 2>&1; then
    cp "$CADDYFILE" "$BASE/Caddyfile.edge.bak"
    cat "$CANDIDATE" > "$CADDYFILE"
    docker exec "$EDGE_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile \
      || { cat "$BASE/Caddyfile.edge.bak" > "$CADDYFILE"; die "edge Caddy rejected the reload; its Caddyfile was restored"; }
    log "Edge Caddy reloaded (previous file: $BASE/Caddyfile.edge.bak)"
  else
    log "WARNING: edge Caddy rejected the park2all block; Caddyfile left unchanged"
  fi
  rm -f "$CANDIDATE"
fi

log "Pruning old releases and images (keeping $KEEP)"
cd "$BASE/releases"
ls -1t | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$BASE/releases/$old" = "$(readlink "$BASE/current")" ] && continue
  rm -rf "$old"
  docker image rm "park2all-app:$old" "park2all-static:$old" >/dev/null 2>&1 || true
done
log "Done: https://$DOMAIN is on $SHA"
