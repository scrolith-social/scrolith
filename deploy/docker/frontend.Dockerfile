# Node 22.23.2 Alpine 3.24; amd64 immutable build-stage digest. This matches
# the repository's supported Node 22 range and current frontend toolchain engines.
FROM node:22.23.2-alpine3.24@sha256:b64da1de5a51067ab8e75f0bc8dbd0905d8894baa22261f439a4572f41291e50 AS build

WORKDIR /workspace/geezle

COPY geezle/package*.json ./
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always
ENV CYPRESS_INSTALL_BINARY=0
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --include=dev --no-audit --no-fund --replace-registry-host=always \
  --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY geezle/ ./

ARG VITE_API_URL=https://api.scrolith.com/api
ARG VITE_BACKEND_URL=https://api.scrolith.com
ARG VITE_SCROLITH_ENV=production
ARG VITE_PUBLIC_APP_DOMAIN=scrolith.com
ARG VITE_MESSAGES_TRACE_DEBUG=false
ARG VITE_INSTANT_GRAPH_ENABLED=false

RUN npm run build -- --base=/

# Nginx 1.30.6 stable Alpine 3.24.4; amd64 immutable runtime digest.
FROM nginx:stable-alpine3.24@sha256:bb8f722b4be005fcd7827816a136ab779fd40185d85b5171be915cc7fc0575c7 AS runtime

# Pin the official Alpine v3.24 package archives by SHA-512. The fixed-version
# URLs are immutable package artifacts; using an empty APK repository list avoids
# resolving through a mutable APKINDEX. apk still verifies each archive's Alpine
# signing key against the trusted keys shipped in the digest-pinned base image.
RUN set -eux; \
  test "$(apk --print-arch)" = "x86_64"; \
  wget -q -O /tmp/zlib-1.4-r0.apk \
    https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/zlib-1.4-r0.apk; \
  wget -q -O /tmp/libxslt-1.1.43-r4.apk \
    https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/libxslt-1.1.43-r4.apk; \
  echo '34F0FEE4793044C61680139BDAF635D425E25FF3A363FD3B516FE43882A35AC2361C881257748870CE9DF08B5A1352932106C73295DE097D830C6DD0A45D7F59  /tmp/zlib-1.4-r0.apk' | sha512sum -c -; \
  echo '682BAF3D62F2CA2DD28C09DE72627E3967BBE9AD13D87CE3B0AF1940BF400F2BF43039B78D422A389C31E497E24C59F71E2B020FC6811D8FAAB7A8D9695C6145  /tmp/libxslt-1.1.43-r4.apk' | sha512sum -c -; \
  apk --repositories-file /dev/null add --no-cache \
    /tmp/zlib-1.4-r0.apk /tmp/libxslt-1.1.43-r4.apk; \
  apk list -I | grep -F 'zlib-1.4-r0 '; \
  apk list -I | grep -F 'libxslt-1.1.43-r4 '; \
  rm -f /tmp/zlib-1.4-r0.apk /tmp/libxslt-1.1.43-r4.apk

COPY deploy/nginx/frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/geezle/dist /usr/share/nginx/html

RUN mkdir -p /var/cache/nginx /var/log/nginx /var/lib/nginx /run \
  && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /var/lib/nginx /run /usr/share/nginx/html

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "--spider", "--quiet", "http://127.0.0.1:8080/"]

CMD ["nginx", "-g", "daemon off;"]
