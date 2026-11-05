# Static Flutter web builds (staff app at /staff/, customer app at /app/), served by a tiny Caddy on :8080.
# The shared edge Caddy proxies /staff/* and /app/* here.
FROM caddy:2.10-alpine
COPY web /srv
COPY infrastructure/docker/static.Caddyfile /etc/caddy/Caddyfile
