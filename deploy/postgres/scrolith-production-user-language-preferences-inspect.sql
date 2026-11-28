-- Read-only snapshot for an initialized database before considering the
-- focused language-preference ACL increment. It performs no writes.
\set ON_ERROR_STOP on
BEGIN READ ONLY;

\echo 'Connection and target facts (the SQL client must independently validate the private FQDN and verify-full TLS):'
SELECT current_database() AS database_name,
       current_setting('server_version_num') AS server_version_num,
       current_user AS inspection_role,
       COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls_enabled,
       to_regclass('public."_prisma_migrations"') IS NOT NULL AS migration_ledger_exists,
       to_regclass('public.scrolith_runtime_policy_state') IS NOT NULL AS runtime_policy_marker_exists;

\echo 'Application role attributes:'
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolinherit
  FROM pg_roles
 WHERE rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
 ORDER BY rolname;

\echo 'Existing finalized policy marker (commit is a policy identifier, not a credential):'
SELECT singleton, source_commit, migration_count, last_migration,
       ownership_verified, finalized, finalized_at, bootstrap_admin_role
  FROM public.scrolith_runtime_policy_state
 ORDER BY singleton;

\echo 'Prisma migration ledger summary:'
SELECT COUNT(*)::integer AS ledger_rows,
       COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::integer AS successfully_applied,
       COUNT(DISTINCT migration_name)::integer AS distinct_migrations,
       MAX(migration_name) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS last_applied
  FROM public."_prisma_migrations";

\echo 'Public-schema object ownership summary:'
SELECT COUNT(*)::integer AS application_relations,
       COUNT(*) FILTER (WHERE pg_get_userbyid(c.relowner) = 'scrolith_migrator')::integer AS migrator_owned,
       COUNT(*) FILTER (WHERE pg_get_userbyid(c.relowner) <> 'scrolith_migrator')::integer AS other_owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_depend e
    ON e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c', 'i', 'I')
   AND e.objid IS NULL;

\echo 'Effective runtime privileges on User (no application rows are read):'
SELECT pg_get_userbyid(c.relowner) AS user_table_owner,
       has_schema_privilege('scrolith_runtime', 'public', 'USAGE') AS schema_usage,
       has_schema_privilege('scrolith_runtime', 'public', 'CREATE') AS schema_create,
       has_table_privilege('scrolith_runtime', 'public."User"', 'SELECT') AS table_select,
       has_table_privilege('scrolith_runtime', 'public."User"', 'INSERT') AS table_insert,
       has_table_privilege('scrolith_runtime', 'public."User"', 'UPDATE') AS table_update,
       has_table_privilege('scrolith_runtime', 'public."User"', 'DELETE') AS table_delete,
       has_table_privilege('scrolith_runtime', 'public."User"', 'TRUNCATE') AS table_truncate,
       jsonb_build_object(
         'understoodLanguages', has_column_privilege('scrolith_runtime', 'public."User"', 'understoodLanguages', 'UPDATE'),
         'languagePreferencesConfirmed', has_column_privilege('scrolith_runtime', 'public."User"', 'languagePreferencesConfirmed', 'UPDATE'),
         'languagePreferencesUpdatedAt', has_column_privilege('scrolith_runtime', 'public."User"', 'languagePreferencesUpdatedAt', 'UPDATE'),
         'followOnboardingRequired', has_column_privilege('scrolith_runtime', 'public."User"', 'followOnboardingRequired', 'UPDATE'),
         'followOnboardingCompletedAt', has_column_privilege('scrolith_runtime', 'public."User"', 'followOnboardingCompletedAt', 'UPDATE'),
         'updatedAt', has_column_privilege('scrolith_runtime', 'public."User"', 'updatedAt', 'UPDATE')
       ) AS reviewed_column_updates,
       ARRAY(
         SELECT a.attname
           FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege('scrolith_runtime', c.oid, a.attname, 'UPDATE')
          ORDER BY a.attnum
       ) AS all_effective_user_update_columns
  FROM pg_class c
 WHERE c.oid = 'public."User"'::regclass;

\echo 'Raw User table and column ACL entries (role names and privileges only):'
SELECT 'table'::text AS scope,
       NULL::text AS column_name,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable,
       pg_get_userbyid(acl.grantor) AS grantor
  FROM pg_class user_table
  CROSS JOIN LATERAL aclexplode(COALESCE(
    user_table.relacl, acldefault('r', user_table.relowner)
  )) acl
 WHERE user_table.oid = 'public."User"'::regclass
UNION ALL
SELECT 'column'::text AS scope,
       user_column.attname::text AS column_name,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable,
       pg_get_userbyid(acl.grantor) AS grantor
  FROM pg_attribute user_column
  CROSS JOIN LATERAL aclexplode(user_column.attacl) acl
 WHERE user_column.attrelid = 'public."User"'::regclass
   AND user_column.attnum > 0
   AND NOT user_column.attisdropped
 ORDER BY scope, column_name NULLS FIRST, grantee, privilege_type, grantor;

\echo 'Memberships involving the three application roles:'
SELECT member_role.rolname AS member_role,
       granted_role.rolname AS granted_role,
       m.admin_option, m.inherit_option, m.set_option
  FROM pg_auth_members m
  JOIN pg_roles member_role ON member_role.oid = m.member
  JOIN pg_roles granted_role ON granted_role.oid = m.roleid
 WHERE member_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
    OR granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
 ORDER BY member_role.rolname, granted_role.rolname;

ROLLBACK;
