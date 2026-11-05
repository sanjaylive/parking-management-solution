# Deployment — park.2all.co.in

`npm run deploy` pushes `main` to GitHub. GitHub Actions tests everything, builds one release bundle and ships it to the VPS, where it is activated atomically with automatic rollback.

```
npm run deploy ─► git push origin main ─► GitHub Actions
                                          ├─ node:    API tests (Postgres+Redis) → build API, operator, booking
                                          ├─ flutter: analyze + test → build staff (/staff/) & customer (/app/) web
                                          └─ deploy:  tar bundle → scp → remote-release.sh on the VPS
```

## URLs (one domain, one certificate)

| Path | Serves |
|---|---|
| `https://park.2all.co.in/` | Booking website (Next.js, PM2 `park2all-booking-web`, :3104) |
| `/operator` | Operator console (Next.js, `park2all-operator-web`, :3101) |
| `/v1/*`, `/health`, `/socket.io/` | API (NestJS, `park2all-api`, :4100) |
| `/staff/` | Staff gate app (Flutter web, static) |
| `/app/` | Customer app (Flutter web, static) |

All Node processes bind to 127.0.0.1; only Nginx (80/443) is exposed.

## One-time setup

### 1. DNS
Add an **A record**: `park.2all.co.in → <VPS IPv4>` (and AAAA if the VPS has IPv6). Wait until `dig +short park.2all.co.in` returns the IP; the certificate step needs it.

### 2. Deploy key
On your machine:
```bash
ssh-keygen -t ed25519 -N "" -C github-deploy -f ~/.ssh/park2all_deploy
```

### 3. Bootstrap the VPS (Ubuntu 22.04/24.04, as root)
```bash
scp -r infrastructure root@<VPS_IP>:/root/park2all-infra
ssh root@<VPS_IP> \
  DOMAIN=park.2all.co.in EMAIL=<your-email> DEPLOY_PUBKEY=\"$(cat ~/.ssh/park2all_deploy.pub)\" \
  bash /root/park2all-infra/scripts/vps-setup.sh
```
This installs Node 24, PM2, Postgres, Redis, Nginx and Certbot. It also:
- creates the `deploy` user and the `park2all` database;
- writes `/opt/park2all/shared/api.env` with random secrets;
- gets the Let's Encrypt certificate and installs the Nginx site.

It is safe to re-run.

### 4. GitHub secrets
Repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `VPS_HOST` | VPS IP or hostname |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | contents of `~/.ssh/park2all_deploy` (private key) |
| `VPS_PORT` | optional, default 22 |
| `VPS_KNOWN_HOSTS` | recommended: output of `ssh-keyscan -H <VPS_IP>` |

Or with the CLI:
```bash
gh secret set VPS_HOST -b "<VPS_IP>"
gh secret set VPS_USER -b deploy
gh secret set VPS_SSH_KEY < ~/.ssh/park2all_deploy
ssh-keyscan -H <VPS_IP> | gh secret set VPS_KNOWN_HOSTS
```
Optional repository variable `PUBLIC_URL` (default `https://park.2all.co.in`) is baked into the web/Flutter builds.

### 5. Deploy
```bash
npm run deploy          # push + watch the run (needs `gh`; otherwise prints the Actions URL)
npm run deploy:status   # recent runs
```

### 6. Demo data (staging only, optional, once)
```bash
ssh deploy@<VPS_IP>
cd /opt/park2all/current/api && set -a && . /opt/park2all/shared/api.env && set +a \
  && SEED_PASSWORD='<choose-a-strong-password>' node dist-seed/prisma/seed.js
```
The seed refuses to run unless `ALLOW_SANDBOX_PROVIDERS=true`, and in production it requires `SEED_PASSWORD` (12+ chars): the default demo password is in this public repo.

## Staging vs production
No SMS or payment-gateway credentials exist yet. `vps-setup.sh` therefore writes `ALLOW_SANDBOX_PROVIDERS=true`, which has these effects:
- The production build runs with the console OTP provider and the sandbox payment provider.
- **OTP codes are returned in API responses.**
- `/health` reports `"sandbox": true`.

Before taking real customers:
1. Configure the real providers.
2. Delete that line from `api.env`.
3. Redeploy.

Without that line, the API refuses to start in production if a sandbox provider is still configured.

## What a release does on the VPS (`infrastructure/scripts/remote-release.sh`)
1. Unpacks to `/opt/park2all/releases/<sha>/` and links `shared/api.env`.
2. Runs `prisma migrate deploy`.
3. Atomically repoints `/opt/park2all/current`, then runs `pm2 startOrReload` (`infrastructure/pm2/ecosystem.config.cjs`).
4. Health-checks the API (it must report the new `release` sha), the operator console, the booking site and both Flutter bundles.
5. **On failure:** repoints to the previous release, reloads, deletes the failed release and exits non-zero. The workflow turns red.
6. Keeps the last 5 releases.

Caveats:
- Rollback restores code, not the database. Migrations must stay backward-compatible with the previous release, so add columns and tables rather than renaming or dropping them in the same release.
- The API runs as a single fork-mode process because Socket.IO and the reservation sweeper are single-instance. A reload means a few seconds of API unavailability.

## Manual rollback
```bash
ssh deploy@<VPS_IP>
ls -t /opt/park2all/releases                      # pick a sha
ln -sfn /opt/park2all/releases/<sha> /opt/park2all/current
pm2 startOrReload /opt/park2all/current/infrastructure/pm2/ecosystem.config.cjs --update-env
```

## Operations
- Logs: `pm2 logs park2all-api`
- Status: `pm2 ls`
- Nginx: `/var/log/nginx/`
- Certificate renewal: the certbot systemd timer, which reloads Nginx after each renewal.
- **Database backups are not automated yet.** Add a nightly `pg_dump` to off-box storage before going live.
