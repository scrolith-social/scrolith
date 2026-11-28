import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFile(resolve(repositoryRoot, path), 'utf8');

test('release workflow is manual-only and builds the selected reviewed backend/main source', async () => {
  const workflow = await read('.github/workflows/production-inspector-release.yml');
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule|workflow_run):/m);
  assert.match(workflow, /source_sha:[\s\S]*?required: true[\s\S]*?type: string/);
  assert.match(workflow, /publish_to_production_acr:[\s\S]*?default: false[\s\S]*?type: boolean/);
  assert.match(workflow, /GITHUB_REF" != 'refs\/heads\/main'/);
  assert.match(workflow, /refs\/heads\/backend\/main:refs\/remotes\/origin\/backend\/main/);
  assert.match(workflow, /git merge-base --is-ancestor "\$SOURCE_SHA" refs\/remotes\/origin\/backend\/main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /--pull --no-cache[\s\S]*?--platform linux\/amd64[\s\S]*?--provenance=mode=max[\s\S]*?type=oci/);
  assert.match(workflow, /--file deploy\/postgres\/inspector\.Dockerfile[\s\S]*?\n            \. 2>&1/,
    'image build must use the repository root as its context');
  assert.match(workflow, /production-inspector-release-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /retention-days: 90/);
});

test('pre-push build and scan have no cloud identity, registry login, or production environment', async () => {
  const workflow = await read('.github/workflows/production-inspector-release.yml');
  const buildStart = workflow.indexOf('  build-and-scan:');
  const publishStart = workflow.indexOf('  publish-production-acr:');
  assert.ok(buildStart >= 0 && publishStart > buildStart);
  const buildJob = workflow.slice(buildStart, publishStart);

  assert.match(buildJob, /permissions:\n      contents: read/);
  assert.doesNotMatch(buildJob, /id-token:\s*write|environment:\s*production|azure\/login@/);
  assert.doesNotMatch(buildJob, /\bsecrets\.|az acr login|skopeo login|docker login/);
  assert.match(buildJob, /--config= --ignorefile= --secret-config=/);
  assert.match(buildJob, /--scanners vuln --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL/);
  assert.match(buildJob, /--exit-code 1/);
  assert.match(buildJob, /noSuppressions': True/);
  assert.match(buildJob, /findingCount/);
  assert.match(buildJob, /ociArchiveSha256/);
});

test('ACR publication is opt-in, post-scan, and held by the existing production approval gate', async () => {
  const workflow = await read('.github/workflows/production-inspector-release.yml');
  const publishStart = workflow.indexOf('  publish-production-acr:');
  assert.ok(publishStart >= 0);
  const publishJob = workflow.slice(publishStart);

  assert.match(publishJob, /needs: build-and-scan/);
  assert.match(publishJob, /inputs\.publish_to_production_acr && github\.ref == 'refs\/heads\/main'/);
  assert.match(publishJob, /environment:\n      name: production/);
  assert.match(publishJob, /permissions:\n      contents: read\n      id-token: write/);
  assert.match(publishJob, /azure\/login@[0-9a-f]{40} # v2\.3\.0/);
  assert.match(publishJob, /vars\.AZURE_CLIENT_ID/);
  assert.match(publishJob, /vars\.AZURE_TENANT_ID/);
  assert.match(publishJob, /vars\.AZURE_SUBSCRIPTION_ID/);
  assert.doesNotMatch(publishJob, /client-secret:|AZURE_CLIENT_SECRET|ACR_ADMIN|admin-enabled/);
  assert.match(publishJob, /REGISTRY: scrolithprodsea2026\.azurecr\.io/);
  assert.match(publishJob, /REPOSITORY: scrolith-tools\/postgres-inspector/);
  assert.doesNotMatch(workflow, /acrscrolithstaging8098|scrolithstaging/i,
    'release workflow must not target the staging registry');
  assert.match(publishJob, /skopeo copy --all --preserve-digests/);
  assert.match(publishJob, /test "\$pushed_digest" = "\$EXPECTED_IMAGE_DIGEST"/);
  assert.match(publishJob, /skopeo inspect --raw --authfile/);
  assert.match(publishJob, /az acr repository show[\s\S]*--query digest --output tsv/);
  assert.match(publishJob, /test "\$served_digest" = "\$PUSHED_DIGEST"/);
  assert.match(publishJob, /--image-src remote[\s\S]*--severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL[\s\S]*--exit-code 1/);
  assert.match(publishJob, /post-push-trivy-report\.json/);
  assert.match(publishJob, /Remove temporary registry credentials and Azure CLI session/);
});

test('all external GitHub Actions in the release workflow use full commit pins', async () => {
  const workflow = await read('.github/workflows/production-inspector-release.yml');
  const uses = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 4);
  for (const action of uses) {
    assert.match(action, /^[^@]+@[0-9a-f]{40}$/, `action is not pinned to a full SHA: ${action}`);
  }
});

test('runbook distinguishes the scanned OCI artifact from a verified ACR image digest', async () => {
  const runbook = await read('docs/SCROLITH_PRODUCTION_DB_INSPECTOR_RUNBOOK.md');
  const bicep = await read('deploy/azure/scrolith-production-db-inspector-job.bicep');
  assert.match(runbook, /OCI artifact is not a production ACR image reference/);
  assert.match(runbook, /Default-branch prerequisite/);
  assert.match(runbook, /existing GitHub `production` environment approval/);
  assert.match(runbook, /post-push digest verification\/scan/);
  assert.match(runbook, /ACR authorization prerequisite/);
  assert.doesNotMatch(runbook, /no final inspector image digest\/build\/scan is available/);
  assert.match(bicep, /postgres-inspector@\$\{inspectorImageDigest\}/);
  assert.match(bicep, /verified by the reviewed inspector image-release evidence after the production ACR push/);
});
