#!/usr/bin/env bash
# One-time VPS bootstrap for Ubuntu 22.04 / 24.04. Run as root:
#   sudo DOMAIN=park.2all.co.in EMAIL=you@example.com DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-deploy" \
#        bash vps-setup.sh
# Idempotent: safe to re-run. Installs Node 24, PM2, Postgres, Redis, Nginx, Certbot; creates the `deploy` user,
# the database, /opt/park2all/shared/api.env (random secrets) and the Nginx site with a Let's Encrypt certificate.
# Prerequisite: an A record for $DOMAIN pointing at this server (needed for the certificate).
set -euo pipefail

DOMAIN=${DOMAIN:-park.2all.co.in}
EMAIL=${EMAIL:?set EMAIL for Let\'s Encrypt expiry notices}
DEPLOY_USER=${DEPLOY_USER:-deploy}
BASE=/opt/park2all
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
NGINX_TEMPLATE=${NGINX_TEMPLATE:-$SCRIPT_DIR/../nginx/park2all.conf}

log() { printf '\033[1;36m[setup]\033[0m %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
[ -f "$NGINX_TEMPLATE" ] || { echo "nginx template not found at $NGINX_TEMPLATE (run from a repo checkout)" >&2; exit 1; }

log "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx postgresql redis-server certbot ufw openssl
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2@6

log "Deploy user and directories"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$BASE" "$BASE/releases"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "$BASE/shared"
if [ -n "${DEPLOY_PUBKEY:-}" ]; then
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "/home/$DEPLOY_USER/.ssh"
  touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
  grep -qF "$DEPLOY_PUBKEY" "/home/$DEPLOY_USER/.ssh/authorized_keys" || echo "$DEPLOY_PUBKEY" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys" && chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi
# PM2 resurrects the saved process list on boot under the deploy user.
env PATH="$PATH" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER" >/dev/null

log "Postgres + Redis (local only)"
systemctl enable --now postgresql redis-server
ENV_FILE="$BASE/shared/api.env"
if [ ! -f "$ENV_FILE" ]; then
  DB_PASS=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_roles WHERE rolname='park2all'" | grep -q 1 \
    && sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE park2all WITH LOGIN PASSWORD '$DB_PASS'" \
    || sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE park2all WITH LOGIN PASSWORD '$DB_PASS'"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='park2all'" | grep -q 1 \
    || sudo -u postgres createdb -O park2all park2all
  rnd() { openssl rand -hex 32; }
  cat > "$ENV_FILE" <<ENV
# Park2All API — production environment. Generated $(date -u +%FT%TZ). Never commit this file.
NODE_ENV=production
PORT=4100
PUBLIC_URL=https://$DOMAIN
DATABASE_URL=postgresql://park2all:$DB_PASS@127.0.0.1:5432/park2all?schema=public
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=$(rnd)
JWT_REFRESH_SECRET=$(rnd)
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
QR_SIGNING_SECRET=$(rnd)
DEVICE_SECRET_ENCRYPTION_KEY=$(rnd)
PAYMENT_WEBHOOK_SECRET=$(rnd)
CORS_ORIGINS=https://$DOMAIN
# No SMS or payment-gateway credentials yet, so this box runs as STAGING: OTPs are returned in API responses and
# payments go through the sandbox. Set real providers and remove this line before taking real customers.
OTP_PROVIDER=console
PAYMENT_PROVIDER=sandbox
ALLOW_SANDBOX_PROVIDERS=true
ENV
  chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE" && chmod 600 "$ENV_FILE"
  log "Wrote $ENV_FILE with fresh secrets"
else
  log "$ENV_FILE exists — leaving it untouched"
fi

log "Firewall"
ufw allow OpenSSH >/dev/null && ufw allow 'Nginx Full' >/dev/null && ufw --force enable >/dev/null

log "Nginx + TLS for $DOMAIN"
mkdir -p /var/www/certbot
rm -f /etc/nginx/sites-enabled/default
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  cat > /etc/nginx/sites-available/park2all.conf <<NGX
server { listen 80; listen [::]:80; server_name $DOMAIN; location /.well-known/acme-challenge/ { root /var/www/certbot; } location / { return 503; } }
NGX
  ln -sfn /etc/nginx/sites-available/park2all.conf /etc/nginx/sites-enabled/park2all.conf
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive \
    --deploy-hook "systemctl reload nginx"
fi
sed "s/__DOMAIN__/$DOMAIN/g" "$NGINX_TEMPLATE" > /etc/nginx/sites-available/park2all.conf
ln -sfn /etc/nginx/sites-available/park2all.conf /etc/nginx/sites-enabled/park2all.conf
nginx -t && systemctl reload nginx

log "Done. Next: add the GitHub secrets (docs/DEPLOYMENT.md) and run \`npm run deploy\` from your machine."
