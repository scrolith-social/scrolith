const url = String(process.env.DATABASE_URL || '');
const shadowUrl = String(process.env.SHADOW_DATABASE_URL || '');
const testDbKind = String(process.env.TEST_DB_KIND || '').trim().toLowerCase();
const testDbProject = String(process.env.TEST_DB_PROJECT || '').trim().toLowerCase();
const testDbInstance = String(process.env.TEST_DB_INSTANCE || '').trim().toLowerCase();
const testDbName = String(process.env.TEST_DB_NAME || '').trim().toLowerCase();

if (process.env.NODE_ENV !== 'test' && process.env.APP_RUNTIME !== 'test') {
  throw new Error('Refusing test database operation outside NODE_ENV=test or APP_RUNTIME=test.');
}

if (process.env.DISABLE_BACKGROUND_WORKERS !== 'true') {
  throw new Error('Refusing database tests unless DISABLE_BACKGROUND_WORKERS=true.');
}

const productionMarkers = [
  'scrolith-postgres-prod',
  'scrolith-500821:asia-southeast1:scrolith-postgres-prod'
];

if ([url, shadowUrl].some((value) => productionMarkers.some((marker) => value.toLowerCase().includes(marker)))) {
  throw new Error('Refusing to run database tests: DATABASE_URL appears to reference production infrastructure.');
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(url);
} catch {
  throw new Error('Refusing database tests: DATABASE_URL is not parseable.');
}

let parsedShadowUrl;
try {
  parsedShadowUrl = new URL(shadowUrl);
} catch {
  throw new Error('Refusing database tests: SHADOW_DATABASE_URL is not parseable.');
}

if (!/^postgres(ql)?:$/i.test(parsedDatabaseUrl.protocol) || !/^postgres(ql)?:$/i.test(parsedShadowUrl.protocol)) {
  throw new Error('Refusing database tests unless both database URLs use PostgreSQL.');
}

const parsedDatabaseName = parsedDatabaseUrl.pathname.replace(/^\/+/, '').toLowerCase();
const parsedShadowDatabaseName = parsedShadowUrl.pathname.replace(/^\/+/, '').toLowerCase();

if (parsedDatabaseName === 'scrolith') {
  throw new Error('Refusing to run database tests: DATABASE_URL appears to reference production infrastructure.');
}

if (testDbProject && testDbProject !== 'cloudbuild-ephemeral' && testDbProject.includes('scrolith-500821')) {
  throw new Error('Refusing to run database tests: TEST_DB_PROJECT is not non-production.');
}

if (!testDbName.includes('test') || parsedDatabaseName !== testDbName || !parsedDatabaseName.includes('test')) {
  throw new Error('Refusing database tests unless database name is explicitly test-only.');
}

if (
  !parsedShadowDatabaseName.includes('shadow') ||
  parsedShadowDatabaseName === parsedDatabaseName ||
  parsedShadowUrl.hostname !== parsedDatabaseUrl.hostname ||
  parsedShadowUrl.port !== parsedDatabaseUrl.port ||
  parsedShadowUrl.username !== parsedDatabaseUrl.username
) {
  throw new Error('Refusing database tests unless SHADOW_DATABASE_URL targets a separate shadow database on the same test endpoint.');
}

if (testDbKind === 'local-postgres') {
  const isLocalTestEndpoint = (candidate) => candidate.hostname === '127.0.0.1' && candidate.port === '55432';
  if (!isLocalTestEndpoint(parsedDatabaseUrl) || !isLocalTestEndpoint(parsedShadowUrl) || testDbInstance !== 'local-postgres-test') {
    throw new Error('Refusing local database tests without isolated local postgres marker.');
  }
} else if (testDbKind === 'cloudbuild-postgres') {
  const isApprovedCiEndpoint = (candidate) =>
    ['postgres-test', '127.0.0.1'].includes(candidate.hostname) && candidate.port === '5432';
  if (
    !isApprovedCiEndpoint(parsedDatabaseUrl) ||
    !isApprovedCiEndpoint(parsedShadowUrl) ||
    testDbProject !== 'cloudbuild-ephemeral' ||
    testDbInstance !== 'cloudbuild-ephemeral-postgres-test'
  ) {
    throw new Error('Refusing Cloud Build database tests without ephemeral postgres markers.');
  }
} else {
  throw new Error('Refusing database tests without approved TEST_DB_KIND.');
}

console.log('Test database guard passed.');
