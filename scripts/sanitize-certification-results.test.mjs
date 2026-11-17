import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sanitizerPath = join(repositoryRoot, 'scripts', 'sanitize-certification-results.mjs');

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

test('sanitizer reports Playwright outcomes and strips unapproved evidence fields', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'scrolith-sanitizer-test-'));
  const resultsRoot = join(testRoot, 'results');
  const safeEvidenceRoot = join(resultsRoot, 'safe-evidence');
  mkdirSync(safeEvidenceRoot, { recursive: true });
  const secondRunRoot = join(resultsRoot, 'iphone-15', 'member-home');
  const secondEvidenceRoot = join(secondRunRoot, 'safe-evidence');
  mkdirSync(secondEvidenceRoot, { recursive: true });
  const rawTestOutput = join(secondRunRoot, 'test-output', 'raw');
  const rawHtmlReport = join(secondRunRoot, 'html-report', 'data');
  mkdirSync(rawTestOutput, { recursive: true });
  mkdirSync(rawHtmlReport, { recursive: true });
  writeFileSync(join(rawTestOutput, 'cert-results.json'), JSON.stringify({ suites: [{ specs: [{ title: 'RAW_TEST_OUTPUT_MUST_NOT_BE_READ' }] }] }));
  writeFileSync(join(rawHtmlReport, 'cert-results.json'), JSON.stringify({ suites: [{ specs: [{ title: 'RAW_HTML_REPORT_MUST_NOT_BE_READ' }] }] }));

  const scenarios = [
    { title: 'passed', status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed', duration: 1 }] },
    { title: 'failed', status: 'unexpected', expectedStatus: 'passed', results: [{ status: 'failed', duration: 2, errors: [{ message: 'SYNTHETIC_STACK' }] }] },
    { title: 'timed out', status: 'unexpected', expectedStatus: 'passed', results: [{ status: 'timedOut', duration: 3 }] },
    { title: 'skipped', status: 'skipped', expectedStatus: 'skipped', annotations: [{ type: 'skip', description: 'requires local auth' }], results: [{ status: 'skipped' }] },
    { title: 'flaky', status: 'flaky', expectedStatus: 'passed', results: [{ status: 'failed' }, { status: 'passed', duration: 4 }] }
  ].map((scenario) => ({
    ...scenario,
    projectName: 'desktop-chrome',
    annotations: scenario.annotations || []
  }));

  writeFileSync(join(resultsRoot, 'cert-results.json'), JSON.stringify({
    suites: [{
      title: 'Synthetic suite',
      specs: [{
        title: 'password=SYNTHETIC_PASSWORD person@example.invalid',
        file: 'tests/synthetic.spec.ts',
        line: 7,
        tests: scenarios
      }]
    }]
  }));
  writeFileSync(join(safeEvidenceRoot, 'synthetic.json'), JSON.stringify({
    schemaVersion: 1,
    scenario: 'member_home_feed',
    project: 'desktop-chrome',
    testIdHash: '012345abcdef',
    pageState: {
      route: 'member_home',
      safePath: '/',
      postCardCount: 2,
      storedUserPresent: true,
      storedUserIdPresent: true,
      storedUserOnboardingFlagPresent: true,
      storedUserOnboardingRequired: true,
      followOnboardingRoute: false,
      memberHomeMarkerCount: 0,
      mobileHomeMarkerCount: 0,
      userId: 'SENSITIVE_SYNTHETIC_USER_ID',
      token: 'SYNTHETIC_TOKEN'
    },
    diagnostics: {
      approvalPolling: {
        responseCount: 3,
        statusCounts: [{ status: 200, count: 2 }, { status: 429, count: 1 }],
        payloadParseFailures: 0,
        pendingRowCount: 1,
        matchingAttemptResponses: 1,
        failedRequestCount: 0,
        elapsedMs: 1250,
        attemptId: 'SENSITIVE_SYNTHETIC_ATTEMPT_ID',
        token: 'SYNTHETIC_TOKEN'
      }
    },
    apiEvents: [{
      kind: 'response',
      route: 'feed',
      method: 'GET',
      status: 200,
      itemCount: 2,
      responseShape: 'items_array',
      url: 'http://127.0.0.1/private?token=SYNTHETIC_TOKEN',
      body: 'SYNTHETIC_BODY'
    }, {
      kind: 'response',
      route: 'auth_me',
      method: 'GET',
      status: 200,
      authUserRecordPresent: true,
      authOnboardingFlagPresent: true,
      authOnboardingRequired: true,
      userId: 'SENSITIVE_SYNTHETIC_USER_ID',
      email: 'person@example.invalid'
    }]
  }));
  writeFileSync(join(secondRunRoot, 'cert-results.json'), JSON.stringify({
    suites: [{
      title: 'Isolated WebKit run',
      specs: [{
        title: 'synthetic browser state',
        file: 'tests/synthetic-webkit.spec.ts',
        line: 11,
        tests: [{
          title: 'WebKit authenticated state',
          projectName: 'iphone-15',
          status: 'expected',
          expectedStatus: 'passed',
          results: [{ status: 'passed', duration: 5 }]
        }]
      }]
    }]
  }));
  writeFileSync(join(secondEvidenceRoot, 'device-approval-iphone-15.json'), JSON.stringify({
    schemaVersion: 1,
    scenario: 'device_approval',
    project: 'iphone-15',
    testIdHash: 'fedcba987654',
    pageState: { route: 'login', storedUserPresent: false, approvalDialogCount: 1 },
    apiEvents: [{ kind: 'response', route: 'approval_list', method: 'GET', status: 200 }]
  }));

  try {
    execFileSync(process.execPath, [sanitizerPath], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CERT_RESULTS_DIR: resultsRoot,
        SCROLITH_ROOT_SHA: 'a'.repeat(40),
        RUNNER_OS: 'Linux'
      },
      stdio: 'pipe'
    });

    const outputRoot = join(resultsRoot, 'sanitized');
    const summary = JSON.parse(readFileSync(join(outputRoot, 'test-summary.json'), 'utf8'));
    assert.deepEqual(summary.counts, {
      passed: 2,
      failed: 1,
      flaky: 1,
      skipped: 1,
      timedOut: 1,
      interrupted: 0,
      unknown: 0
    });
    assert.equal(summary.tests.some((item) => item.run === 'iphone-15_member-home'), true);
    const sanitizedSynthetic = JSON.parse(readFileSync(join(outputRoot, 'synthetic.json'), 'utf8'));
    assert.equal(sanitizedSynthetic.pageState.storedUserPresent, true);
    assert.equal(sanitizedSynthetic.pageState.storedUserIdPresent, true);
    assert.equal(sanitizedSynthetic.pageState.storedUserOnboardingRequired, true);
    assert.equal(sanitizedSynthetic.pageState.memberHomeMarkerCount, 0);
    const sanitizedAuthEvent = sanitizedSynthetic.apiEvents.find((event) => event.route === 'auth_me');
    assert.deepEqual({
      authUserRecordPresent: sanitizedAuthEvent.authUserRecordPresent,
      authOnboardingFlagPresent: sanitizedAuthEvent.authOnboardingFlagPresent,
      authOnboardingRequired: sanitizedAuthEvent.authOnboardingRequired
    }, { authUserRecordPresent: true, authOnboardingFlagPresent: true, authOnboardingRequired: true });
    assert.equal(Object.hasOwn(sanitizedAuthEvent, 'userId'), false);
    assert.deepEqual(sanitizedSynthetic.diagnostics.approvalPolling.statusCounts, [
      { status: 200, count: 2 },
      { status: 429, count: 1 }
    ]);
    assert.equal(sanitizedSynthetic.diagnostics.approvalPolling.matchingAttemptResponses, 1);
    assert.equal(Object.hasOwn(sanitizedSynthetic.diagnostics.approvalPolling, 'attemptId'), false);
    assert.equal(existsSync(join(outputRoot, 'iphone-15_member-home__device-approval-iphone-15.json')), true);
    const manifest = JSON.parse(readFileSync(join(outputRoot, 'manifest.json'), 'utf8'));
    assert.equal(manifest.isolatedRunCount, 2);
    const evidenceManifest = JSON.parse(readFileSync(join(outputRoot, 'evidence-manifest.json'), 'utf8'));
    assert.equal(evidenceManifest.files.some((item) => item.name === 'iphone-15_member-home__device-approval-iphone-15.json'), true);

    const safeOutput = listFiles(outputRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    for (const marker of [
      'person@example.invalid',
      'SYNTHETIC_PASSWORD',
      'SYNTHETIC_STACK',
      'SYNTHETIC_TOKEN',
      'SENSITIVE_SYNTHETIC_ATTEMPT_ID',
      'SYNTHETIC_BODY',
      'SENSITIVE_SYNTHETIC_USER_ID',
      'RAW_TEST_OUTPUT_MUST_NOT_BE_READ',
      'RAW_HTML_REPORT_MUST_NOT_BE_READ',
      'http://127.0.0.1/private'
    ]) {
      assert.equal(safeOutput.includes(marker), false, `sanitized output leaked ${marker}`);
    }
    assert.equal(safeOutput.includes('unknown'), true);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});
