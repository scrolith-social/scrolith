#!/bin/sh
set -eu
umask 077

# Pin this one-shot runner to the ARM-verified production database hostname.
# The VNet's private DNS must resolve this canonical TLS name to the private IP.
[ "${PGHOST:-}" = 'psql-scrolith-prod-sea-2026.postgres.database.azure.com' ] || exit 78
[ "${PGPORT:-}" = '5432' ] || exit 78
[ "${PGDATABASE:-}" = 'scrolith' ] || exit 78
[ "${PGUSER:-}" = 'scrolith_inspector' ] || exit 78
[ "${PGSSLMODE:-}" = 'verify-full' ] || exit 78
[ "${PGSSLROOTCERT:-}" = '/etc/ssl/certs/ca-certificates.crt' ] || exit 78
[ -r "$PGSSLROOTCERT" ] || exit 78
[ -n "${PGPASSWORD:-}" ] || exit 78

# Buffer output so a partial report is never persisted on a failed query.
# Do not enable shell tracing or print the environment. Suppress psql stderr;
# ACA job success/failure remains visible in execution metadata, while stdout
# contains only the complete inspection report.
report_file="$(mktemp /tmp/scrolith-inspection.XXXXXX)"
trap 'rm -f "$report_file"' EXIT HUP INT TERM
if psql -X -q -w -v ON_ERROR_STOP=1 --file=/opt/scrolith/inspect.sql >"$report_file" 2>/dev/null; then
  cat "$report_file"
else
  exit $?
fi
