# Minimal PostgreSQL 17 client-only runner. Pin the official Alpine linux/amd64
# child manifest and the directly installed client and CA-bundle versions.
# Alpine v3.24 remains supported through 2028-06-01.
FROM alpine:3.24.4@sha256:0f49f331d9212aff11b932863be4eb01cdf962969aa86dab7d1ee21ac6f5f52b

ARG POSTGRESQL17_CLIENT_VERSION=17.12-r0
ARG CA_CERTIFICATES_BUNDLE_VERSION=20261020-r0

LABEL org.opencontainers.image.title="Scrolith production metadata inspector"
LABEL org.opencontainers.image.description="Runs only the checked-in read-only Scrolith PostgreSQL inspection report"

RUN set -eux; \
    apk add --no-cache \
      "postgresql17-client=${POSTGRESQL17_CLIENT_VERSION}" \
      "ca-certificates-bundle=${CA_CERTIFICATES_BUNDLE_VERSION}"; \
    test -x /usr/libexec/postgresql17/psql; \
    psql --version | grep -F "${POSTGRESQL17_CLIENT_VERSION%-r*}"; \
    test -r /etc/ssl/certs/ca-certificates.crt; \
    apk info -e postgresql17-client >/dev/null; \
    apk info -e ca-certificates-bundle >/dev/null; \
    if apk info -e postgresql17 >/dev/null 2>&1; then exit 1; fi; \
    test ! -e /usr/libexec/postgresql17/postgres; \
    addgroup -S -g 10001 scrolith-inspector; \
    adduser -S -D -H -u 10001 -G scrolith-inspector -h /nonexistent scrolith-inspector; \
    for client_tool in /usr/libexec/postgresql17/*; do \
      [ "${client_tool##*/}" = psql ] || rm -f "$client_tool"; \
    done; \
    for client_tool in clusterdb createdb createuser dropdb dropuser pg_amcheck \
      pg_basebackup pg_dump pg_dumpall pg_isready pg_receivewal pg_recvlogical \
      pg_restore pg_verifybackup pgbench reindexdb vacuumdb; do \
      rm -f "/usr/bin/${client_tool}"; \
    done; \
    rm -f /usr/bin/pg_versions; \
    test -x /usr/libexec/postgresql17/psql; \
    test -L /usr/bin/psql; \
    psql --version | grep -F "${POSTGRESQL17_CLIENT_VERSION%-r*}"

WORKDIR /opt/scrolith
COPY deploy/postgres/scrolith-production-user-language-preferences-inspect.sql /opt/scrolith/inspect.sql
COPY deploy/postgres/run-production-inspector.sh /opt/scrolith/run-inspector.sh

USER 10001:10001
RUN set -eu; \
    test "$(id -u)" = 10001; \
    test -r /etc/ssl/certs/ca-certificates.crt; \
    test -w /tmp; \
    psql --version | grep -F "${POSTGRESQL17_CLIENT_VERSION%-r*}"; \
    ! command -v postgres >/dev/null 2>&1; \
    ! command -v pg_dump >/dev/null 2>&1

ENTRYPOINT ["/bin/sh", "/opt/scrolith/run-inspector.sh"]
