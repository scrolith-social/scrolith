\set ON_ERROR_STOP on
\if :{?SCROLITH_ROLE_SETUP_APPROVED}
\else
  DO $approval_guard$ BEGIN RAISE EXCEPTION 'Explicit role setup approval is required'; END $approval_guard$;
\endif
SELECT :'SCROLITH_ROLE_SETUP_APPROVED' = 'true' AS media_role_setup_approved \gset
\if :media_role_setup_approved
\else
  DO $approval_guard$ BEGIN RAISE EXCEPTION 'Explicit role setup approval must be true'; END $approval_guard$;
\endif
-- Separate migration/bootstrap administrator only. NOLOGIN until separately reviewed enablement.
BEGIN;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='scrolith_media_dispatch') THEN
    CREATE ROLE scrolith_media_dispatch NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='scrolith_media_worker') THEN
    CREATE ROLE scrolith_media_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('scrolith_media_dispatch','scrolith_media_worker')
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Media roles must be disabled and unprivileged before policy setup';
  END IF;
  IF EXISTS (SELECT FROM pg_stat_activity WHERE usename IN ('scrolith_media_dispatch','scrolith_media_worker')) THEN
    RAISE EXCEPTION 'Drain media sessions before policy setup';
  END IF;
  IF EXISTS (SELECT FROM pg_class WHERE relowner IN
    (SELECT oid FROM pg_roles WHERE rolname IN ('scrolith_media_dispatch','scrolith_media_worker'))) THEN
    RAISE EXCEPTION 'Media roles must not own schema objects';
  END IF;
  IF EXISTS (SELECT FROM pg_auth_members WHERE member IN
    (SELECT oid FROM pg_roles WHERE rolname IN ('scrolith_media_dispatch','scrolith_media_worker'))) THEN
    RAISE EXCEPTION 'Media roles must not inherit other roles';
  END IF;
END
$roles$;
ALTER ROLE scrolith_media_dispatch NOLOGIN;
ALTER ROLE scrolith_media_worker NOLOGIN;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM scrolith_media_dispatch,scrolith_media_worker;
SELECT current_database() AS media_database \gset
GRANT CONNECT ON DATABASE :"media_database" TO scrolith_media_dispatch,scrolith_media_worker;
GRANT USAGE ON SCHEMA public TO scrolith_media_dispatch,scrolith_media_worker;
GRANT SELECT ON public.azure_media_jobs TO scrolith_media_dispatch;
GRANT UPDATE(last_dispatched_at) ON public.azure_media_jobs TO scrolith_media_dispatch;
GRANT SELECT ON public.azure_media_jobs,public.files,public.file_variants TO scrolith_media_worker;
GRANT UPDATE(status,attempts,fence,lease_until,next_at,error_code,source_sha256,updated_at)
  ON public.azure_media_jobs TO scrolith_media_worker;
GRANT INSERT ON public.file_variants TO scrolith_media_worker;
GRANT UPDATE(height,storage_provider,storage_key,size_bytes,checksum,status,updated_at)
  ON public.file_variants TO scrolith_media_worker;
GRANT UPDATE(processing_status,processing_error_code,processing_completed_at,processing_started_at,width,height,duration,thumbnail_url)
  ON public.files TO scrolith_media_worker;
-- No financial, auth, migration-ledger, source ownership/visibility, delete or DDL access.
-- Do not enable these credentials until primary runtime finalization and this policy are verified.
COMMIT;