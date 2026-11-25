import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreTemplate = readFileSync(join(root, 'deploy/azure/scrolitha-core-containerapp.bicep'), 'utf8');
const apiTemplate = readFileSync(join(root, 'deploy/azure/api-containerapp-single-replica.bicep'), 'utf8');

test('Core remains private in the existing app environment and scales from zero to one replica', () => {
  assert.match(coreTemplate, /managedEnvironmentId:\s*managedEnvironmentResourceId/);
  assert.match(coreTemplate, /ingress:\s*\{\s*external:\s*false/);
  assert.match(coreTemplate, /scale:\s*\{\s*minReplicas:\s*0\s*maxReplicas:\s*1\s*\}/);
});

test('API AI provider gates remain disabled while bounded usage defaults are configured', () => {
  assert.match(apiTemplate, /SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS',\s*value:\s*'500000'/);
  assert.match(apiTemplate, /SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS',\s*value:\s*'1000'/);
  assert.match(apiTemplate, /SCROLITHA_TIMEOUT_MS',\s*value:\s*'180000'/);
  assert.match(apiTemplate, /SCROLITHA_AI_MAX_REQUEST_RUNTIME_MS',\s*value:\s*'180000'/);
  assert.match(apiTemplate, /SCROLITHA_AI_OLLAMA_ENABLED',\s*value:\s*'false'/);
  assert.match(apiTemplate, /SCROLITHA_AI_NATIVE_PROVIDER_ENABLED',\s*value:\s*'false'/);
  assert.match(apiTemplate, /SCROLITHA_AI_ENABLE_PROVIDER_CALLS',\s*value:\s*'false'/);
  assert.match(apiTemplate, /SCROLITHA_AI_ALLOW_PROD_PROVIDER',\s*value:\s*'0'/);
});
