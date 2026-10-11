import assert from 'node:assert/strict';
import test from 'node:test';
import { findSecretBoundaryViolations } from './check-pr-workflow-secrets.mjs';

test('accepts PR and push workflows without secret references', () => {
  const workflows = [
    {
      filename: 'pr.yml',
      source: 'on:\n  pull_request:\n    branches: [backend/main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n'
    },
    {
      filename: 'push.yml',
      source: 'on:\n  push:\n    branches: [backend/main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n'
    }
  ];

  assert.deepEqual(findSecretBoundaryViolations(workflows), []);
});

test('rejects a secret reference in a pull_request workflow', () => {
  const workflows = [{
    filename: 'unsafe-pr.yml',
    source: 'on:\n  pull_request:\njobs:\n  test:\n    env:\n      API_KEY: ${{ secrets.API_KEY }}\n'
  }];

  assert.deepEqual(findSecretBoundaryViolations(workflows), [
    'unsafe-pr.yml: secret reference in PR-triggered workflow'
  ]);
});

test('rejects a secret reference in a pull_request_target workflow', () => {
  const workflows = [{
    filename: 'unsafe-target.yml',
    source: 'on:\n  pull_request_target:\njobs:\n  test:\n    env:\n      API_KEY: ${{ secrets.API_KEY }}\n'
  }];

  assert.deepEqual(findSecretBoundaryViolations(workflows), [
    'unsafe-target.yml: secret reference in PR-triggered workflow'
  ]);
});

test('rejects workflow-level secrets on a push-triggered workflow', () => {
  const workflows = [{
    filename: 'unsafe-push.yml',
    source: 'on:\n  push:\nenv:\n  DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}\njobs:\n  build:\n    runs-on: ubuntu-latest\n'
  }];

  assert.deepEqual(findSecretBoundaryViolations(workflows), [
    'unsafe-push.yml: secret reference in push-triggered workflow'
  ]);
});

test('rejects job-scoped secrets in a push-triggered build workflow', () => {
  const workflows = [{
    filename: 'unsafe-push-job.yml',
    source: 'on:\n  push:\njobs:\n  build:\n    env:\n      API_KEY: ${{ secrets.API_KEY }}\n'
  }];

  assert.deepEqual(findSecretBoundaryViolations(workflows), [
    'unsafe-push-job.yml: secret reference in push-triggered workflow'
  ]);
});
