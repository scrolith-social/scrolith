import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const resultsRoot = resolve(process.env.CERT_RESULTS_DIR || '');
if (!process.env.CERT_RESULTS_DIR) throw new Error('CERT_RESULTS_DIR is required.');
const outputRoot = join(resultsRoot, 'sanitized');
mkdirSync(outputRoot, { recursive: true });

const redactText = (value) => String(value || '')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email-redacted]')
  .replace(/https?:\/\/[^\s"'<>]+/gi, '[url-redacted]')
  .replace(/bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
  .replace(/(token|password|secret|credential)[=: ]+[^\s"']+/gi, '$1=[redacted]')
  .replace(/[A-Za-z]:\\[^\s"']+/g, '[local-path-redacted]')
  .slice(0, 240);

const safeProject = (value) => /^[a-z0-9_-]{1,40}$/i.test(String(value || '')) ? String(value) : 'unknown';
const safeRunName = (value) => {
  const normalized = String(value || '').split(sep).filter(Boolean).join('_');
  return /^[a-z0-9_-]{1,100}$/i.test(normalized) ? normalized : 'unknown';
};
const safeStatuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted', 'expected', 'unknown']);
const statusOf = (value) => safeStatuses.has(value) ? value : 'unknown';
const testStatusOf = (test, finalResult) => {
  const value = test.status || finalResult.status || (test.expectedStatus === 'skipped' ? 'skipped' : 'unknown');
  if (value === 'expected') return test.expectedStatus === 'skipped' ? 'skipped' : 'passed';
  if (value === 'unexpected') {
    return ['timedOut', 'interrupted'].includes(finalResult.status) ? finalResult.status : 'failed';
  }
  return statusOf(value);
};

function findFiles(root, predicate, files = []) {
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const excludedDirectory = /^(?:blob-report|html-report|playwright-report|sanitized|test-output)$/i.test(entry.name);
      if (resolve(path) !== outputRoot && !excludedDirectory) {
        findFiles(path, predicate, files);
      }
    } else if (entry.isFile() && predicate(path)) {
      files.push(path);
    }
  }
  return files;
}
const classifyError = (value) => {
  const text = String(value || '');
  if (/intercepts pointer events|intercepted by .*button/i.test(text)) return 'ui_interception';
  if (/timeout|timed out/i.test(text)) return 'timeout';
  if (/expected:|received:|toBe|toEqual|assert/i.test(text)) return 'assertion';
  return 'test_error';
};
const skipCategory = (value) => {
  const text = String(value || '');
  if (/post cards|feed fixture|scroll item|survey/i.test(text)) return 'fixture_unavailable';
  if (/requires|must be configured|credential|storage state/i.test(text)) return 'environment_prerequisite';
  return 'test_declared';
};

function collectTests(suite, parents = [], output = []) {
  for (const spec of suite?.specs || []) {
    const title = redactText(spec.title);
    for (const test of spec.tests || []) {
      const results = Array.isArray(test.results) ? test.results : [];
      const finalResult = results.at(-1) || {};
      const failedEarlier = results.slice(0, -1).some((item) => ['failed', 'timedOut'].includes(item.status));
      const normalizedStatus = testStatusOf(test, finalResult);
      const status = normalizedStatus === 'flaky' || (failedEarlier && finalResult.status === 'passed')
        ? 'flaky'
        : normalizedStatus;
      const annotations = [...(test.annotations || []), ...(finalResult.annotations || [])];
      const rawSkip = annotations.find((item) => /skip/i.test(String(item.type || '')))?.description || '';
      const rawError = (finalResult.errors || [])[0];
      output.push({
        title: [...parents, title].filter(Boolean).join(' › '),
        file: basename(String(spec.file || 'unknown')),
        line: Number.isInteger(spec.line) ? spec.line : undefined,
        project: safeProject(test.projectName),
        status,
        expectedStatus: statusOf(test.expectedStatus),
        durationMs: Number.isFinite(finalResult.duration) ? Math.max(0, Math.round(finalResult.duration)) : undefined,
        retry: Number.isInteger(finalResult.retry) ? finalResult.retry : 0,
        skipCategory: status === 'skipped' ? skipCategory(rawSkip || rawError?.message) : undefined,
        failureKind: ['failed', 'timedOut', 'interrupted'].includes(status) ? classifyError(rawError?.message) : undefined
      });
    }
  }
  for (const child of suite?.suites || []) collectTests(child, [...parents, redactText(child.title)], output);
  return output;
}

let tests = [];
let reportAvailable = false;
let validReportCount = 0;
const rawReportPaths = findFiles(resultsRoot, (path) => basename(path) === 'cert-results.json');
for (const rawReportPath of rawReportPaths) {
  try {
    const raw = JSON.parse(readFileSync(rawReportPath, 'utf8'));
    const runName = safeRunName(relative(resultsRoot, dirname(rawReportPath)) || 'default');
    tests.push(...collectTests({ suites: raw.suites || [] }).map((item) => ({ ...item, run: runName })));
    reportAvailable = true;
    validReportCount += 1;
  } catch {
    // Malformed report output is excluded; other isolated runs remain reportable.
  }
}

const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0, timedOut: 0, interrupted: 0, unknown: 0 };
for (const item of tests) {
  if (Object.hasOwn(counts, item.status)) counts[item.status] += 1;
  else counts.unknown += 1;
}

const safeRootSha = process.env.SCROLITH_ROOT_SHA || execFileSync('git', ['-C', '..', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const frontendSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const lock = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8'));
const playwrightVersion = lock.packages?.['node_modules/@playwright/test']?.version || lock.packages?.['node_modules/playwright']?.version || 'unknown';
const manifest = {
  schemaVersion: 1,
  rootSourceSha: safeRootSha,
  frontendSourceSha: frontendSha,
  browserConfig: 'tests/certification/playwright.config.ts',
  nodeVersion: process.version,
  playwrightVersion,
  runnerOs: ['Linux', 'Windows', 'macOS'].includes(process.env.RUNNER_OS || '') ? process.env.RUNNER_OS : process.platform,
  generatedAtUtc: new Date().toISOString(),
  isolatedRunCount: validReportCount,
  rawPlaywrightReportAvailable: reportAvailable,
  rawArtifactsUploaded: false
};

writeFileSync(join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
writeFileSync(join(outputRoot, 'test-summary.json'), JSON.stringify({ schemaVersion: 1, counts, tests }, null, 2), 'utf8');

const safeEvidencePaths = findFiles(resultsRoot, (path) => basename(dirname(path)) === 'safe-evidence');
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const allowedRoutes = new Set(['feed', 'auth_me', 'follow_onboarding', 'login', 'logout', 'approval_list', 'approval_exchange', 'notifications', 'human_verification']);
const allowedScenarios = new Set(['device_approval', 'member_home_feed', 'notifications', 'signup_hv', 'logout']);
const allowedFailureKinds = new Set(['timeout', 'connection', 'aborted', 'other']);
const evidenceManifest = [];

for (const source of safeEvidencePaths) {
  const name = basename(source);
  if (!/^[a-z0-9_-]{1,100}\.(json|png)$/i.test(name)) continue;
  const evidenceRun = safeRunName(
    relative(resultsRoot, dirname(source)).split(sep).filter((part) => part !== 'safe-evidence').join('_') || 'default'
  );
  const safeName = evidenceRun === 'default' ? name : `${evidenceRun}__${name}`;
  const dest = join(outputRoot, safeName);
  if (name.endsWith('.png')) {
    const bytes = readFileSync(source);
    if (bytes.length <= 10 * 1024 * 1024 && bytes.subarray(0, 8).equals(pngSignature)) {
      copyFileSync(source, dest);
      evidenceManifest.push({ name: safeName, type: 'masked_screenshot' });
    }
    continue;
  }
  try {
    const raw = JSON.parse(readFileSync(source, 'utf8'));
    if (raw.schemaVersion !== 1 || !allowedScenarios.has(raw.scenario)) continue;
    const counts = raw.pageState && typeof raw.pageState === 'object' ? raw.pageState : {};
    const pageState = {
      route: ['member_home', 'notifications', 'login', 'signup', 'other', 'unavailable'].includes(counts.route) ? counts.route : 'unavailable',
      safePath: ['/', '/member-home', '/m/home', '/auth/follow-onboarding', '/auth/login', '/auth/signup', 'other'].includes(counts.safePath) ? counts.safePath : 'other',
      readyState: ['loading', 'interactive', 'complete', 'unavailable'].includes(counts.readyState) ? counts.readyState : 'unavailable',
      visibility: ['visible', 'hidden', 'prerender', 'unavailable'].includes(counts.visibility) ? counts.visibility : 'unavailable',
      authenticatedStoragePresent: counts.authenticatedStoragePresent === true,
      localTokenKeyPresent: counts.localTokenKeyPresent === true,
      localAccessTokenKeyPresent: counts.localAccessTokenKeyPresent === true,
      localScrolithTokenKeyPresent: counts.localScrolithTokenKeyPresent === true,
      tokenCookiePresent: counts.tokenCookiePresent === true,
      storedUserPresent: counts.storedUserPresent === true,
      storedUserIdPresent: counts.storedUserIdPresent === true,
      storedUserOnboardingFlagPresent: counts.storedUserOnboardingFlagPresent === true,
      storedUserOnboardingRequired: counts.storedUserOnboardingRequired === true,
      clientAuthState: ['loading', 'authenticated', 'anonymous', 'unavailable'].includes(counts.clientAuthState) ? counts.clientAuthState : 'unavailable',
      clientFollowOnboardingRequired: ['true', 'false', 'unknown', 'unavailable'].includes(counts.clientFollowOnboardingRequired) ? counts.clientFollowOnboardingRequired : 'unavailable',
      followOnboardingRoute: counts.followOnboardingRoute === true,
      memberHomeMarkerCount: Number.isInteger(counts.memberHomeMarkerCount) ? Math.max(0, counts.memberHomeMarkerCount) : 0,
      mobileHomeMarkerCount: Number.isInteger(counts.mobileHomeMarkerCount) ? Math.max(0, counts.mobileHomeMarkerCount) : 0,
      postCardCount: Number.isInteger(counts.postCardCount) ? Math.max(0, counts.postCardCount) : 0,
      mainCount: Number.isInteger(counts.mainCount) ? Math.max(0, counts.mainCount) : 0,
      loginFormCount: Number.isInteger(counts.loginFormCount) ? Math.max(0, counts.loginFormCount) : 0,
      loadingIndicatorCount: Number.isInteger(counts.loadingIndicatorCount) ? Math.max(0, counts.loadingIndicatorCount) : 0,
      alertCount: Number.isInteger(counts.alertCount) ? Math.max(0, counts.alertCount) : 0,
      approvalDialogCount: Number.isInteger(counts.approvalDialogCount) ? Math.max(0, counts.approvalDialogCount) : 0,
      responsiveNavigation: (() => {
        const navigation = counts.responsiveNavigation && typeof counts.responsiveNavigation === 'object'
          ? counts.responsiveNavigation
          : {};
        const allowedHitTargets = new Set(['desktop_account_menu', 'mobile_profile', 'mobile_quick_menu', 'other_control', 'none']);
        return {
          viewportWidth: Number.isInteger(navigation.viewportWidth) ? Math.min(2400, Math.max(0, navigation.viewportWidth)) : 0,
          mobileProfileVisible: navigation.mobileProfileVisible === true,
          desktopAccountMenuVisible: navigation.desktopAccountMenuVisible === true,
          mobileQuickMenuVisible: navigation.mobileQuickMenuVisible === true,
          accountSheetVisible: navigation.accountSheetVisible === true,
          desktopAccountMenuHitTarget: allowedHitTargets.has(navigation.desktopAccountMenuHitTarget)
            ? navigation.desktopAccountMenuHitTarget
            : 'none'
        };
      })(),
      documentBodyPresent: counts.documentBodyPresent === true
    };
    const apiEvents = (Array.isArray(raw.apiEvents) ? raw.apiEvents : []).slice(-120).flatMap((event, index) => {
      if (!allowedRoutes.has(event.route) || !['response', 'request_failed'].includes(event.kind)) return [];
      const item = { sequence: index + 1, kind: event.kind, route: event.route, method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method) ? event.method : 'OTHER' };
      if (Number.isInteger(event.status) && event.status >= 100 && event.status <= 599) item.status = event.status;
      if (Number.isFinite(event.durationMs)) item.durationMs = Math.max(0, Math.round(event.durationMs));
      if (allowedFailureKinds.has(event.failure)) item.failure = event.failure;
      if (typeof event.authUserRecordPresent === 'boolean') item.authUserRecordPresent = event.authUserRecordPresent;
      if (typeof event.authOnboardingFlagPresent === 'boolean') item.authOnboardingFlagPresent = event.authOnboardingFlagPresent;
      if (typeof event.authOnboardingRequired === 'boolean') item.authOnboardingRequired = event.authOnboardingRequired;
      if (Number.isInteger(event.itemCount)) item.itemCount = Math.max(0, event.itemCount);
      if (['items_array', 'missing_items', 'invalid_json'].includes(event.responseShape)) item.responseShape = event.responseShape;
      return [item];
    });
    const rawApprovalPolling = raw.diagnostics?.approvalPolling;
    const approvalPolling = rawApprovalPolling && typeof rawApprovalPolling === 'object'
      ? {
          responseCount: Number.isInteger(rawApprovalPolling.responseCount) ? Math.max(0, rawApprovalPolling.responseCount) : 0,
          statusCounts: (Array.isArray(rawApprovalPolling.statusCounts) ? rawApprovalPolling.statusCounts : [])
            .filter((item) => Number.isInteger(item?.status) && item.status >= 100 && item.status <= 599 && Number.isInteger(item?.count))
            .slice(0, 20)
            .map((item) => ({ status: item.status, count: Math.max(0, item.count) })),
          payloadParseFailures: Number.isInteger(rawApprovalPolling.payloadParseFailures) ? Math.max(0, rawApprovalPolling.payloadParseFailures) : 0,
          pendingRowCount: Number.isInteger(rawApprovalPolling.pendingRowCount) ? Math.max(0, rawApprovalPolling.pendingRowCount) : 0,
          matchingAttemptResponses: Number.isInteger(rawApprovalPolling.matchingAttemptResponses) ? Math.max(0, rawApprovalPolling.matchingAttemptResponses) : 0,
          failedRequestCount: Number.isInteger(rawApprovalPolling.failedRequestCount) ? Math.max(0, rawApprovalPolling.failedRequestCount) : 0,
          elapsedMs: Number.isFinite(rawApprovalPolling.elapsedMs) ? Math.max(0, Math.round(rawApprovalPolling.elapsedMs)) : 0
        }
      : undefined;
    const sanitized = {
      schemaVersion: 1,
      scenario: raw.scenario,
      project: safeProject(raw.project),
      testIdHash: /^[a-f0-9]{12}$/.test(raw.testIdHash) ? raw.testIdHash : undefined,
      pageState,
      apiEvents,
      networkTrace: apiEvents,
      ...(approvalPolling ? { diagnostics: { approvalPolling } } : {})
    };
    writeFileSync(dest, JSON.stringify(sanitized, null, 2), 'utf8');
    evidenceManifest.push({ name: safeName, type: raw.scenario === 'logout' ? 'sanitized_network_trace_and_responsive_navigation' : 'safe_network_and_dom_diagnostics' });
  } catch {
    // Unknown or malformed evidence is excluded rather than copied raw.
  }
}

writeFileSync(join(outputRoot, 'evidence-manifest.json'), JSON.stringify({ schemaVersion: 1, files: evidenceManifest }, null, 2), 'utf8');
console.log(`Sanitized browser evidence prepared: ${tests.length} tests, ${evidenceManifest.length} allow-listed evidence files.`);
