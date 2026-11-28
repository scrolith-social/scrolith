-- Read-only assertion shared by the existing-database language-preference
-- grant and rollback procedures. It does not change schema, roles, markers, or ACLs.
DO $existing_database_user_preflight$
DECLARE
  bootstrap_admin TEXT;
  total_migrations INTEGER;
  applied_migrations INTEGER;
  distinct_migrations INTEGER;
  last_migration_name TEXT;
  marker_rows INTEGER;
  updateable_language_columns INTEGER;
  language_state TEXT := current_setting('scrolith.user_language_update_state', true);
  allowed_user_columns TEXT[] := ARRAY[
    'authSessionVersion', 'avatar', 'country', 'currency_preference_updated_at',
    'email', 'followOnboardingCompletedAt', 'followOnboardingRequired', 'isActive',
    'isOnline', 'isVerified', 'kycStatus', 'languagePreferencesConfirmed',
    'languagePreferencesUpdatedAt', 'lastLoginAt', 'lastSeenAt',
    'loginApprovalWaivedById', 'loginApprovalWaivedReason', 'loginApprovalWaivedUntil',
    'name', 'passwordHash', 'preferred_currency', 'profilePhotoFileId', 'refreshToken',
    'role', 'understoodLanguages', 'updatedAt', 'username'
  ];
  language_columns TEXT[] := ARRAY[
    'languagePreferencesConfirmed', 'languagePreferencesUpdatedAt', 'understoodLanguages'
  ];
BEGIN
  IF current_user <> 'scrolith_migrator' THEN
    RAISE EXCEPTION 'incremental User permission procedure must run as the existing scrolith_migrator object owner';
  END IF;
  IF language_state NOT IN ('none_or_all', 'all', 'none') THEN
    RAISE EXCEPTION 'incremental User permission procedure has no valid ACL-state assertion mode';
  END IF;
  IF to_regclass('public."User"') IS NULL
     OR to_regclass('public."_prisma_migrations"') IS NULL
     OR to_regclass('public.scrolith_runtime_policy_state') IS NULL THEN
    RAISE EXCEPTION 'initialized application tables, migration ledger, or policy marker are missing';
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public."User"'::regclass)) <> current_user
     OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public."_prisma_migrations"'::regclass)) <> current_user
     OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.scrolith_runtime_policy_state'::regclass)) <> current_user THEN
    RAISE EXCEPTION 'User, migration ledger, and policy marker must retain migrator ownership';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_depend e
        ON e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c', 'i', 'I')
       AND e.objid IS NULL
       AND pg_get_userbyid(c.relowner) <> 'scrolith_migrator'
  ) THEN
    RAISE EXCEPTION 'initialized public-schema relations differ from the migrator-owned release';
  END IF;

  SELECT COUNT(*)::integer,
         COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::integer,
         COUNT(DISTINCT migration_name)::integer,
         MAX(migration_name) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
    INTO total_migrations, applied_migrations, distinct_migrations, last_migration_name
    FROM public."_prisma_migrations";
  IF total_migrations <> 143 OR applied_migrations <> 143 OR distinct_migrations <> 143
     OR last_migration_name <> '20261122100000_restrict_order_gig_history'
     OR EXISTS (
       SELECT 1 FROM public."_prisma_migrations"
        WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'initialized migration ledger differs from the reviewed 143-migration release';
  END IF;

  SELECT COUNT(*)::integer INTO marker_rows
    FROM public.scrolith_runtime_policy_state;
  IF marker_rows <> 1 OR NOT EXISTS (
    SELECT 1
      FROM public.scrolith_runtime_policy_state
     WHERE singleton
       AND source_commit = current_setting('scrolith.expected_policy_source_commit', true)
       AND migration_count = 143
       AND last_migration = '20261122100000_restrict_order_gig_history'
       AND ownership_verified
       AND finalized
       AND finalized_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'existing finalized policy marker does not match the separately declared baseline commit';
  END IF;
  SELECT bootstrap_admin_role INTO bootstrap_admin
    FROM public.scrolith_runtime_policy_state WHERE singleton;
  IF bootstrap_admin IS NULL OR EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
       OR (granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
           AND (member_role.rolname <> bootstrap_admin
                OR NOT m.admin_option OR m.inherit_option OR m.set_option))
  ) OR (
    SELECT COUNT(*) FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname = bootstrap_admin
      AND granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
      AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
  ) <> 3 THEN
    RAISE EXCEPTION 'existing application-role membership state differs from the reviewed bootstrap';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_runtime' AND rolcanlogin
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_migrator'
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_backup' AND NOT rolcanlogin
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
  ) THEN
    RAISE EXCEPTION 'active runtime or disabled backup role attributes differ from the reviewed policy';
  END IF;
  IF has_schema_privilege('scrolith_runtime', 'public', 'CREATE')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'SELECT')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'INSERT')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'DELETE')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'SELECT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'INSERT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'DELETE') THEN
    RAISE EXCEPTION 'runtime has unexpected schema, migration-ledger, or policy-marker privileges';
  END IF;

  IF has_table_privilege('scrolith_runtime', 'public."User"', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."User"', 'DELETE')
     OR has_table_privilege('scrolith_runtime', 'public."User"', 'TRUNCATE')
     OR EXISTS (
       SELECT 1 FROM unnest(allowed_user_columns) allowed(column_name)
        WHERE NOT (allowed.column_name = ANY(language_columns))
          AND NOT has_column_privilege('scrolith_runtime', 'public."User"', allowed.column_name, 'UPDATE')
     )
     OR EXISTS (
       SELECT 1 FROM information_schema.columns user_column
        WHERE user_column.table_schema = 'public'
          AND user_column.table_name = 'User'
          AND has_column_privilege('scrolith_runtime', 'public."User"', user_column.column_name, 'UPDATE')
          AND NOT user_column.column_name = ANY(allowed_user_columns)
     ) THEN
    RAISE EXCEPTION 'existing User ACL differs from the reviewed column-scoped baseline';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_class user_table
      CROSS JOIN LATERAL aclexplode(COALESCE(
        user_table.relacl, acldefault('r', user_table.relowner)
      )) acl
     WHERE user_table.oid = 'public."User"'::regclass
       AND acl.grantee = 0
  ) OR EXISTS (
    SELECT 1
      FROM pg_attribute user_column
      CROSS JOIN LATERAL aclexplode(user_column.attacl) acl
     WHERE user_column.attrelid = 'public."User"'::regclass
       AND user_column.attnum > 0
       AND NOT user_column.attisdropped
       AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC retains unexpected User table or column privileges';
  END IF;
  SELECT COUNT(*)::integer INTO updateable_language_columns
    FROM unnest(language_columns) allowed(column_name)
   WHERE has_column_privilege('scrolith_runtime', 'public."User"', allowed.column_name, 'UPDATE');
  IF (language_state = 'none' AND updateable_language_columns <> 0)
     OR (language_state = 'all' AND updateable_language_columns <> 3)
     OR (language_state = 'none_or_all' AND updateable_language_columns NOT IN (0, 3)) THEN
    RAISE EXCEPTION 'language-preference UPDATE columns are partially granted or differ from the expected procedure phase';
  END IF;
END
$existing_database_user_preflight$;
