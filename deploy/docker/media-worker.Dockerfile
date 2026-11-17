# Node 22.23.2 Bookworm slim; amd64 immutable base digest. The backend package
# requires Node >=22.18.0 <23, so the worker must use the same supported major.
FROM node:22.23.2-bookworm-slim@sha256:43aeff40f4afc22e83f7589a2f37e111cff5ca84529571f1c8415bcc5fcc21b2 AS builder
WORKDIR /app/geezle-backend
COPY geezle-backend/package*.json ./
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always
RUN npm ci --include=dev --no-audit --no-fund --replace-registry-host=always \
  --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 \
  && npm cache clean --force
COPY geezle-backend/src ./src
COPY geezle-backend/prisma ./prisma
COPY geezle-backend/prisma.config.ts ./
COPY geezle-backend/scripts ./scripts
COPY geezle-backend/tsconfig*.json ./
RUN npm run prisma:generate
RUN npm run build:prod
RUN find dist -type f -name '*.map' -delete

# Use an immutable, timestamped official Debian archive for ffmpeg and its
# transitive packages. This avoids resolving against the mutable live mirror.
# The minimal Node image has no OS CA bundle before this install. Debian apt
# verifies signed Release/index metadata and package hashes over HTTP, so use
# the snapshot's supported HTTP endpoint without disabling signature checks.
FROM node:22.23.2-bookworm-slim@sha256:43aeff40f4afc22e83f7589a2f37e111cff5ca84529571f1c8415bcc5fcc21b2 AS runtime
RUN set -eux; \
  rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; \
  printf '%s\n' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261117T000000Z bookworm main' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261117T000000Z bookworm-updates main' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261117T000000Z bookworm-security main' \
    > /etc/apt/sources.list.d/scrolith-snapshot.list; \
  apt-get update; \
  apt-get install -y --no-install-recommends ffmpeg ca-certificates; \
  rm -rf /var/lib/apt/lists/*
WORKDIR /app/geezle-backend
COPY geezle-backend/package*.json ./
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always
RUN npm ci --omit=dev --no-audit --no-fund --replace-registry-host=always \
  --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm \
    node_modules/prisma node_modules/@prisma/dev node_modules/@prisma/config \
    node_modules/@prisma/studio-core node_modules/@visx node_modules/mysql2 \
    node_modules/deepmerge-ts node_modules/typescript
COPY --from=builder /app/geezle-backend/dist ./dist
COPY --from=builder /app/geezle-backend/node_modules/.prisma ./node_modules/.prisma
RUN groupadd --system appgroup \
  && useradd --system --gid appgroup --create-home appuser \
  && mkdir -p uploads \
  && chown appuser:appgroup uploads
ENV NODE_ENV=production
ENV MEDIA_WORKER_SERVICE=true
ENV MEDIA_PROCESSING_MODE=disabled
ENV MEDIA_VIDEO_PROCESSING_ENABLED=false
ENV MEDIA_IMAGE_PROCESSING_ENABLED=false
ENV PORT=8080
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/mediaWorker.server.js"]
