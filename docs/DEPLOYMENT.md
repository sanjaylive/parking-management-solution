# Deployment — park.2all.co.in

`npm run deploy` pushes `main` to GitHub. GitHub Actions tests everything, builds two Docker images from the release and ships them to the VPS, where the stack is started with Docker Compose and rolled back automatically if it is unhealthy.

```
npm run deploy ─► git push origin main ─► GitHub Actions
                                          ├─ node:    API tests (Postgres+Redis) → build API, operator, booking
                                          ├─ flutter: analyze + test → build staff (/staff/) & customer (/app/) web
                                          └─ deploy:  docker build park2all-app + park2all-static → docker save
                                                      → scp → remote-release.sh on the VPS (docker load + compose)
```

## The shared VPS

148.66.152.2 (GoDaddy, Ubuntu 22.04, user `twoall`) already runs other Docker stacks: pay2all, ahost and hostelerp. Ports 80/443 belong to **pay2all's Caddy container** (`pay2all-caddy-1`). Park2All follows the same pattern as hostelerp:

- Its own Compose project, `park2all` (`infrastructure/docker/compose.yml`), with its own Postgres and Redis on a private network.
- The four web-facing services join the edge network `pay2all_internal` under unique names: `park-api`, `park-operator`, `park-booking` and `park-static`. No ports are published.
- The `park.2all.co.in` site block (`infrastructure/caddy/park2all.caddy`) lives in the edge Caddyfile between `# BEGIN park2all` and `# END park2all` markers. A copy is committed in the pay2all repo (`payinpayout/infra/deploy/Caddyfile`) so Pay2All releases keep it. Every Park2All deploy also re-applies it to the live Caddyfile: it validates the change inside the Caddy container first, then reloads Caddy, and restores the old file if the reload fails. **If you change the block, change both copies.** Caddy issues the certificate itself.

## URLs (one domain)

| Path | Serves |
|---|---|
| `https://park.2all.co.in/` | Booking website (Next.js, `park-booking:3104`) |
| `/operator` | Operator console (Next.js, `park-operator:3101`) |
| `/admin` → `/operator/admin` | Platform admin portal (same app; Super Admin / Support accounts) |
| `/v1/*`, `/health`, `/socket.io/` | API (NestJS, `park-api:4100`) |
| `/staff/` | Staff gate app (Flutter web, `park-static:8080`) |
| `/app/` | Customer app (Flutter web, `park-static:8080`) |

## One-time setup

### 1. DNS
Already done: `park.2all.co.in → 148.66.152.2`.

### 2. Deploy key
CI logs in as `twoall` (it is in the `docker` group, as the other stacks' deploys require):
```bash
ssh-keygen -t ed25519 -N "" -C github-deploy -f ~/.ssh/park2all_deploy      # already created
ssh-copy-id -i ~/.ssh/park2all_deploy.pub twoall@148.66.152.2
```

### 3. GitHub secrets
```bash
gh secret set VPS_HOST -b "148.66.152.2"
gh secret set VPS_USER -b twoall
gh secret set VPS_SSH_KEY < ~/.ssh/park2all_deploy
ssh-keyscan -H 148.66.152.2 | gh secret set VPS_KNOWN_HOSTS
```
`VPS_PORT` is optional (default 22). The optional repository variable `PUBLIC_URL` (default `https://park.2all.co.in`) is baked into the web and Flutter builds.

Nothing has to be installed on the server. The first deploy creates `/opt/park2all` (using passwordless sudo once) and generates `/opt/park2all/.env.production` (mode 600) with fresh secrets.

### 4. Deploy
```bash
npm run deploy          # push + watch the run (needs `gh`; otherwise prints the Actions URL)
npm run deploy:status   # recent runs
```

### 5. Demo data (staging only, optional, once)
```bash
ssh twoall@148.66.152.2
cd /opt/park2all/current
APP_RELEASE=$(basename "$(readlink -f .)") ENV_FILE=/opt/park2all/.env.production EDGE_NETWORK=pay2all_internal \
  docker compose -p park2all -f infrastructure/docker/compose.yml --env-file /opt/park2all/.env.production \
  run --rm -e SEED_PASSWORD='<choose-a-strong-password>' migrate node dist-seed/prisma/seed.js
```
The seed refuses to run unless `ALLOW_SANDBOX_PROVIDERS=true`, and in production it requires `SEED_PASSWORD` (12+ chars), because the default demo password is in this public repo.

## Staging vs production
No SMS or payment-gateway credentials exist yet, so the generated `.env.production` contains `ALLOW_SANDBOX_PROVIDERS=true`. This has the following effects:
- The production build runs with the console OTP provider and the sandbox payment provider.
- **OTP codes are returned in API responses.**
- `/health` reports `"sandbox": true`.

Before taking real customers:
1. Configure the real providers in `/opt/park2all/.env.production`.
2. Delete the `ALLOW_SANDBOX_PROVIDERS` line.
3. Redeploy.

Without that line, the API refuses to start in production if a sandbox provider is still configured.

## What a release does on the VPS (`infrastructure/scripts/remote-release.sh`)
1. `docker load`s the images `park2all-app:<sha>` and `park2all-static:<sha>`. Then it unpacks `infrastructure/` to `/opt/park2all/releases/<sha>/`.
2. Runs `prisma migrate deploy` in a one-off `migrate` container.
3. Runs `docker compose up -d --wait`, which waits for every healthcheck. The API must also report the new `release` sha.
4. If healthy, it repoints `/opt/park2all/current` and makes sure the edge Caddy has the `park.2all.co.in` block.
5. **On failure:** it starts the previous release again, deletes the failed release and exits non-zero. The workflow turns red.
6. Keeps the last 3 releases and their images.

Caveats:
- Rollback restores code, not the database. Migrations must stay backward-compatible with the previous release, so add columns and tables rather than renaming or dropping them in the same release.
- The API is a single container because Socket.IO and the reservation sweeper are single-instance. A deploy means a few seconds of API unavailability.
- Unlike the old Nginx config, the edge Caddy does not rate-limit `/v1/auth/`. Rely on the API's own throttling, or add a Caddy rate-limit module before going live.
- The server has about 4 GB RAM shared by all stacks. The containers' memory limits total about 1.3 GB, though actual use is much lower. Watch `docker stats` after the first deploy.

## Manual rollback
```bash
ssh twoall@148.66.152.2
ls -t /opt/park2all/releases                      # pick a sha (its images are kept with it)
R=/opt/park2all/releases/<sha>
APP_RELEASE=<sha> ENV_FILE=/opt/park2all/.env.production EDGE_NETWORK=pay2all_internal \
  docker compose -p park2all -f $R/infrastructure/docker/compose.yml --env-file /opt/park2all/.env.production up -d --wait
ln -sfn $R /opt/park2all/current
```

## Operations
- Status: `docker compose -p park2all ps`
- Logs: `docker logs -f park2all-park-api-1`
- Edge proxy logs: `docker logs pay2all-caddy-1`. Certificates renew automatically.
- **Database backups are not automated yet.** Add a nightly `docker exec park2all-park-postgres-1 pg_dump -U park2all park2all` to off-box storage before going live.
