# Official PostgreSQL 17 client image, pinned to the linux/amd64 child
# manifest observed from Docker Hub on 2026-11-28. Update only with review.
FROM postgres:17-bookworm@sha256:c7a16500f728a9c09731e772f228ee7a29615585e8019772f05b620522f62d03

LABEL org.opencontainers.image.title="Scrolith production metadata inspector"
LABEL org.opencontainers.image.description="Runs only the checked-in read-only Scrolith PostgreSQL inspection report"

WORKDIR /opt/scrolith
COPY deploy/postgres/scrolith-production-user-language-preferences-inspect.sql /opt/scrolith/inspect.sql
COPY deploy/postgres/run-production-inspector.sh /opt/scrolith/run-inspector.sh

USER postgres
ENTRYPOINT ["/bin/sh", "/opt/scrolith/run-inspector.sh"]
