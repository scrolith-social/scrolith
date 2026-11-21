-- Production-specific target guard. This is separate from, and does not change,
-- the disposable-only guards in scrolith-runtime-*.sql.
\set ON_ERROR_STOP on

\set _prod_guard_failed true
\if :{?SCROLITH_PRODUCTION_CHANGE_APPROVED}
  \if :SCROLITH_PRODUCTION_CHANGE_APPROVED
    \set _prod_guard_failed false
  \endif
\endif
\if :_prod_guard_failed
DO $guard$ BEGIN RAISE EXCEPTION 'explicit production change approval is required'; END $guard$;
\endif

\set _prod_guard_failed true
\if :{?expected_server_fqdn}
  \if :{?expected_source_commit}
    \set _prod_guard_failed false
  \endif
\endif
\if :_prod_guard_failed
DO $guard$ BEGIN RAISE EXCEPTION 'expected_server_fqdn and expected_source_commit are required'; END $guard$;
\endif

SELECT (
  :'expected_server_fqdn' ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.postgres\.database\.azure\.com$'
  AND :'expected_source_commit' ~ '^[0-9a-f]{40}$'
) AS _prod_context_valid \gset
\if :_prod_context_valid
\else
DO $guard$ BEGIN RAISE EXCEPTION 'target FQDN or release SHA has invalid format'; END $guard$;
\endif

SELECT (
  current_database() = 'scrolith'
  AND current_setting('server_version_num')::integer >= 170000
  AND current_setting('server_version_num')::integer < 180000
  AND current_setting('transaction_read_only') = 'off'
  AND NOT pg_is_in_recovery()
) AS _prod_database_valid \gset
\if :_prod_database_valid
\else
DO $guard$ BEGIN RAISE EXCEPTION 'expected writable PostgreSQL 17 database named scrolith'; END $guard$;
\endif

SELECT COALESCE((
  SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()
), FALSE) AS _connection_uses_tls \gset
\if :_connection_uses_tls
\else
DO $guard$ BEGIN RAISE EXCEPTION 'production role procedure requires a TLS-protected PostgreSQL session'; END $guard$;
\endif

\echo 'Production target declared by operator: ' :expected_server_fqdn
\echo 'Application release SHA declared by operator: ' :expected_source_commit
