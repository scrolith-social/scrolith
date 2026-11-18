# Node 22 on Alpine 3.24; amd64 immutable builder/runtime manifest digest.
FROM node:22-alpine3.24@sha256:947e5454e08bfe0b8ddda604915ad76275276c774f47da90d0137252c793a778 AS node-base
# Install the exact official Alpine v3.24 fixed zlib archive. Its SHA-512 is
# pinned below and apk verifies its Alpine signature; an empty repository list
# prevents resolution against a mutable APKINDEX.
RUN set -eux; \
  test "$(apk --print-arch)" = "x86_64"; \
  wget -q -O /tmp/zlib-1.4-r0.apk \
    https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/zlib-1.4-r0.apk; \
  echo '34F0FEE4793044C61680139BDAF635D425E25FF3A363FD3B516FE43882A35AC2361C881257748870CE9DF08B5A1352932106C73295DE097D830C6DD0A45D7F59  /tmp/zlib-1.4-r0.apk' | sha512sum -c -; \
  apk --repositories-file /dev/null add --no-cache /tmp/zlib-1.4-r0.apk; \
  apk list -I | grep -F 'zlib-1.4-r0 '; \
  rm -f /tmp/zlib-1.4-r0.apk

FROM node-base AS builder
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

FROM node-base AS migrator
WORKDIR /app/geezle-backend
COPY geezle-backend/package*.json ./
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always
RUN npm ci --omit=dev --no-audit --no-fund --replace-registry-host=always \
  --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 \
  && node -e "const cli=require('./node_modules/prisma/package.json').version; const client=require('./node_modules/@prisma/client/package.json').version; if(cli!==client) throw new Error('Prisma CLI/client version mismatch')" \
  && test ! -e node_modules/jest \
  && test ! -e node_modules/ts-jest \
  && test ! -e node_modules/ts-node-dev \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm
COPY geezle-backend/prisma ./prisma
COPY geezle-backend/prisma.config.ts ./
ENV NODE_ENV=production
RUN addgroup -S migrator \
  && adduser -S -G migrator migrator
USER migrator
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM node-base AS runtime
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
RUN addgroup -S appgroup \
  && adduser -S -G appgroup appuser \
  && mkdir -p uploads \
  && chown appuser:appgroup uploads
ENV NODE_ENV=production
USER appuser
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
