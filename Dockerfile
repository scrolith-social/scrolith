FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV CYPRESS_INSTALL_BINARY=0
RUN npm ci --include=dev --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY . .

ARG VITE_API_URL=https://api.scrolith.com/api
ARG VITE_BACKEND_URL=https://api.scrolith.com
ARG VITE_SCROLITH_ENV=production
ARG VITE_PUBLIC_APP_DOMAIN=scrolith.com
ARG VITE_PUBLIC_APP_URL=https://scrolith.com
ARG VITE_MESSAGES_TRACE_DEBUG=false

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_SCROLITH_ENV=${VITE_SCROLITH_ENV}
ENV VITE_PUBLIC_APP_DOMAIN=${VITE_PUBLIC_APP_DOMAIN}
ENV VITE_PUBLIC_APP_URL=${VITE_PUBLIC_APP_URL}
ENV VITE_MESSAGES_TRACE_DEBUG=${VITE_MESSAGES_TRACE_DEBUG}

RUN npm run build

FROM nginx:stable-alpine3.24-slim@sha256:e9eaa7298465eab06d618c51556fdcf3fb5061f9ff40bd28ee898fbd7ee7f900 AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Pin the fixed Alpine zlib package bytes and keep apk signature validation enabled.
# The exact archive hash protects against mutable repository contents; apk add
# verifies the package signature using the trusted keys in the pinned base image.
RUN set -eux; \
    apk_arch="$(apk --print-arch)"; \
    case "$apk_arch" in \
      x86_64) expected_sha256=7b05bc778b8b25cd880835b40114182bd4d1581717504d0129c810c0a14291cb ;; \
      aarch64) expected_sha256=d3e30d012a3445222b0b4a28f1d4d97ce67387f8b48561921111696da174f0de ;; \
      *) echo "Unsupported runtime architecture for pinned zlib package: $apk_arch" >&2; exit 1 ;; \
    esac; \
    package_path=/tmp/zlib-1.4-r0.apk; \
    wget -q -O "$package_path" "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/$apk_arch/zlib-1.4-r0.apk"; \
    echo "$expected_sha256  $package_path" | sha256sum -c -; \
    apk add --no-cache "$package_path"; \
    rm -f "$package_path"

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
