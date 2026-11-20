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

# Official Nginx 1.30.7 on Alpine 3.24; immutable linux/amd64 manifest digest.
FROM nginx:1.30.7-alpine3.24@sha256:4d1d4ce08432dc7dfe4af762cb224ce6b5273ae878f41e020ea2425d02ea91a4 AS runtime

# Pin the official Alpine v3.24 package archives by SHA-512. The fixed-version
# URLs are immutable package artifacts; using an empty APK repository list avoids
# resolving through a mutable APKINDEX. apk still verifies each archive's Alpine
# signing key against the trusted keys shipped in the digest-pinned base image.
RUN set -eux; \
  fetch_apk() { \
    url="$1"; dest="$2"; attempt=1; \
    while [ "$attempt" -le 5 ]; do \
      if wget -q -T 30 -O "$dest" "$url"; then return 0; fi; \
      rm -f "$dest"; \
      if [ "$attempt" -eq 5 ]; then return 1; fi; \
      sleep "$attempt"; \
      attempt=$((attempt + 1)); \
    done; \
    return 1; \
  }; \
  test "$(apk --print-arch)" = "x86_64"; \
  fetch_apk https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/zlib-1.4-r0.apk /tmp/zlib-1.4-r0.apk; \
  fetch_apk https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/libxslt-1.1.43-r4.apk /tmp/libxslt-1.1.43-r4.apk; \
  fetch_apk https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/libxml2-2.13.9-r3.apk /tmp/libxml2-2.13.9-r3.apk; \
  fetch_apk https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/libssl3-3.5.9-r1.apk /tmp/libssl3-3.5.9-r1.apk; \
  fetch_apk https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/libcrypto3-3.5.9-r1.apk /tmp/libcrypto3-3.5.9-r1.apk; \
  echo '34F0FEE4793044C61680139BDAF635D425E25FF3A363FD3B516FE43882A35AC2361C881257748870CE9DF08B5A1352932106C73295DE097D830C6DD0A45D7F59  /tmp/zlib-1.4-r0.apk' | sha512sum -c -; \
  echo '682BAF3D62F2CA2DD28C09DE72627E3967BBE9AD13D87CE3B0AF1940BF400F2BF43039B78D422A389C31E497E24C59F71E2B020FC6811D8FAAB7A8D9695C6145  /tmp/libxslt-1.1.43-r4.apk' | sha512sum -c -; \
  echo 'D90C254D02E92C0A25E385D5B2695D32A9BF37C85F6BB6D92350A5FB0B8245EB59B78165001BE90EC853695100DD6533BB3FE08894EC047A507F780E59544125  /tmp/libxml2-2.13.9-r3.apk' | sha512sum -c -; \
  echo 'A0B0CC88EC040D18AE8373C240A10132E3D21A7350FAEFC54327D21DC739D17CC773D68D2D0667174B64B2F1A5610AB61DC8B7317D0E0714723D275A41B38636  /tmp/libssl3-3.5.9-r1.apk' | sha512sum -c -; \
  echo '605130CBC99DAB98DE459BDDCAD4DDEC8B1AD963FE438EEA593A28858B4144F90A154E295C08FAD7E176B3D978B2408EF3F327BDF7215790B4F37EB947FCBE3B  /tmp/libcrypto3-3.5.9-r1.apk' | sha512sum -c -; \
  apk --repositories-file /dev/null add --no-cache \
    /tmp/zlib-1.4-r0.apk /tmp/libxslt-1.1.43-r4.apk /tmp/libxml2-2.13.9-r3.apk \
    /tmp/libssl3-3.5.9-r1.apk /tmp/libcrypto3-3.5.9-r1.apk; \
  apk list -I | grep -F 'zlib-1.4-r0 '; \
  apk list -I | grep -F 'libxslt-1.1.43-r4 '; \
  apk list -I | grep -F 'libxml2-2.13.9-r3 '; \
  apk list -I | grep -F 'libssl3-3.5.9-r1 '; \
  apk list -I | grep -F 'libcrypto3-3.5.9-r1 '; \
  rm -f /tmp/zlib-1.4-r0.apk /tmp/libxslt-1.1.43-r4.apk /tmp/libxml2-2.13.9-r3.apk \
    /tmp/libssl3-3.5.9-r1.apk /tmp/libcrypto3-3.5.9-r1.apk

COPY deploy/nginx/frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/geezle/dist /usr/share/nginx/html

RUN mkdir -p /var/cache/nginx /var/log/nginx /var/lib/nginx /run \
  && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /var/lib/nginx /run /usr/share/nginx/html

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "--spider", "--quiet", "http://127.0.0.1:8080/"]

CMD ["nginx", "-g", "daemon off;"]
