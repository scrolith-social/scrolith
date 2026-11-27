import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/ci-secrets.yml', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');
const lines = workflow.split(/\r?\n/);

function topLevelJobRange(jobName) {
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `workflow must define the ${jobName} job`);

  let end = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:\s*$/.test(line));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join('\n');
}

const buildJob = topLevelJobRange('build');
const deployJob = topLevelJobRange('deploy');
const jobsStart = lines.findIndex((line) => line === 'jobs:');
assert.notEqual(jobsStart, -1, 'workflow must define jobs');
const beforeJobs = lines.slice(0, jobsStart).join('\n');
const secretRefs = [...workflow.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]);

test('pull-request build has no secret-bearing environment or secret references', () => {
  assert.doesNotMatch(beforeJobs, /^env:\s*$/m, 'workflow-level env can leak secrets to every job');
  assert.doesNotMatch(buildJob, /\$\{\{\s*secrets\./, 'build and PR-controlled scripts must receive no secrets');
  assert.doesNotMatch(buildJob, /\$\{\{\s*vars\./, 'build must not receive deployment configuration variables');
  assert.deepEqual(secretRefs.sort(), [
    'BACKEND_URL',
    'DEPLOY_HOST', 'DEPLOY_HOST',
    'DEPLOY_PATH', 'DEPLOY_PATH',
    'DEPLOY_SSH_KEY',
    'DEPLOY_USER', 'DEPLOY_USER',
  ]);
  assert.doesNotMatch(workflow, /pull_request_target:/, 'privileged pull_request_target is not allowed');
});

test('workflow and jobs grant read-only repository access without cloud identity', () => {
  assert.match(beforeJobs, /^permissions:\s*\n  contents:\s*read\s*$/m);
  assert.match(buildJob, /permissions:\s*\n      contents:\s*read/);
  assert.match(deployJob, /permissions:\s*\n      contents:\s*read/);
  assert.doesNotMatch(workflow, /(?:id-token|contents|packages|actions):\s*write|write-all/);
  assert.doesNotMatch(workflow, /azure\/login|ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
});

test('checkout credentials are not persisted for code-executing jobs', () => {
  const checkoutUses = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /uses:\s*actions\/checkout@/.test(line));

  assert.equal(checkoutUses.length, 2, 'expected build and deploy checkout steps');
  for (const { index } of checkoutUses) {
    const nextStep = lines.findIndex((line, candidate) => candidate > index && /^      - name:/.test(line));
    const step = lines.slice(index, nextStep === -1 ? lines.length : nextStep).join('\n');
    assert.match(step, /persist-credentials:\s*false/);
  }
});

test('deployment is restricted to manually authorized main runs and the protected environment', () => {
  assert.match(deployJob, /github\.event_name == 'workflow_dispatch'/);
  assert.match(deployJob, /github\.ref == 'refs\/heads\/main'/);
  assert.match(deployJob, /inputs\.deploy_production == true/);
  assert.match(deployJob, /environment:\s*\n      name:\s*production/);
  assert.doesNotMatch(buildJob, /\$\{\{\s*secrets\./);
});

test('production URL is deployment-only and the production job does not consume the check build output', () => {
  assert.match(deployJob, /BACKEND_URL:\s*\$\{\{\s*secrets\.BACKEND_URL\s*\}\}/);
  assert.doesNotMatch(buildJob, /upload-artifact/);
  assert.doesNotMatch(deployJob, /download-artifact/);
  assert.match(deployJob, /rsync[\s\S]*\.\/geezle-backend\//);
  assert.match(deployJob, /npm ci --omit=dev/);
  assert.doesNotMatch(deployJob, /npm run build/);
});

test('SSH deployment action is pinned to its verified upstream full commit SHA', () => {
  assert.match(
    deployJob,
    /uses:\s*webfactory\/ssh-agent@e83874834305fe9a4a2997156cb26c5de65a8555\s+# v0\.10\.0/,
  );
  assert.doesNotMatch(deployJob, /uses:\s*webfactory\/ssh-agent@v/);
});
