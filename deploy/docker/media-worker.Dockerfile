# Use the same pinned Alpine/musl base as the API for the generated Prisma client and Sharp.
FROM node:22-alpine3.24@sha256:947e5454e08bfe0b8ddda604915ad76275276c774f47da90d0137252c793a778 AS builder
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
RUN DATABASE_URL=postgresql://127.0.0.1:5432/prisma_build \
  SHADOW_DATABASE_URL=postgresql://127.0.0.1:5432/prisma_build_shadow \
  npm run prisma:generate
RUN npm run build:prod
RUN find dist -type f -name '*.map' -delete

# Install only the official signed APKs in the reviewed codec dependency closure.
FROM node:22-alpine3.24@sha256:947e5454e08bfe0b8ddda604915ad76275276c774f47da90d0137252c793a778 AS runtime
COPY deploy/docker/media-worker-alpine-apks.lock /tmp/media-worker-alpine-apks.lock
RUN set -eu; \
  test "$(apk --print-arch)" = x86_64; \
  mkdir /tmp/media-apks; \
  cd /tmp/media-apks; \
  while read -r checksum url; do \
    case "$checksum" in ''|\#*) continue ;; esac; \
    case "$url" in https://dl-cdn.alpinelinux.org/alpine/v3.24/*/x86_64/*.apk) ;; *) exit 1 ;; esac; \
    name="${url##*/}"; \
    wget -q -O "$name" "$url"; \
    printf '%s  %s\n' "$checksum" "$name" | sha512sum -c -; \
  done < /tmp/media-worker-alpine-apks.lock; \
  apk --repositories-file /dev/null --no-network add --no-cache ./*.apk; \
  rm -rf /tmp/media-apks /tmp/media-worker-alpine-apks.lock
WORKDIR /app/geezle-backend
COPY geezle-backend/package*.json ./
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always
RUN npm ci --omit=dev --no-audit --no-fund --replace-registry-host=always \
  --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm \
    node_modules/prisma node_modules/@prisma/dev node_modules/@prisma/config \
    node_modules/@prisma/studio-core node_modules/@visx node_modules/mysql2 \
    node_modules/deepmerge-ts node_modules/typescript \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* /sbin/apk
COPY --from=builder /app/geezle-backend/dist ./dist
COPY --from=builder /app/geezle-backend/node_modules/.prisma ./node_modules/.prisma
RUN addgroup -S appgroup \
  && adduser -S -G appgroup appuser \
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
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/mediaWorker.server.js"]
