# Runtime image for the Node apps (API, operator console, booking site). Built in CI from the assembled release
# (infrastructure/scripts/package-release.sh output), so nothing is compiled here.
# glibc (Debian) base on purpose: Prisma engines and native modules are built on Ubuntu in CI (debian-openssl-3.0.x).
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node api ./api
COPY --chown=node:node operator-web ./operator-web
COPY --chown=node:node booking-web ./booking-web
ARG RELEASE_SHA=unknown
ENV RELEASE_SHA=$RELEASE_SHA
USER node
