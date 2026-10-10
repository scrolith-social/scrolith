import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDirectory = path.join(repositoryRoot, '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowsDirectory)
  .filter((name) => /\.ya?ml$/i.test(name));
const secretReference = /\$\{\{\s*secrets\./i;
const violations = [];

const hasEventTrigger = (source, eventName) => {
  const blockTrigger = new RegExp(`^\\s{2}${eventName}\\s*:`, 'm');
  const inlineTrigger = new RegExp(`^on:\\s*(?:\\[[^\\]]*\\b${eventName}\\b[^\\]]*\\]|${eventName}\\s*(?:#.*)?)$`, 'm');
  return blockTrigger.test(source) || inlineTrigger.test(source);
};

const hasWorkflowLevelSecretEnv = (source) => {
  const match = source.match(/^env:\s*\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/m);
  return Boolean(match && secretReference.test(match[1]));
};

for (const filename of workflowFiles) {
  const workflowPath = path.join(workflowsDirectory, filename);
  const source = fs.readFileSync(workflowPath, 'utf8');

  if ((hasEventTrigger(source, 'pull_request') || hasEventTrigger(source, 'pull_request_target')) && secretReference.test(source)) {
    violations.push(`${filename}: secret reference in PR-triggered workflow`);
  }

  if (hasEventTrigger(source, 'push') && hasWorkflowLevelSecretEnv(source)) {
    violations.push(`${filename}: workflow-level secret environment in push-triggered workflow`);
  }
}

if (violations.length > 0) {
  console.error(`Unsafe workflow secret scope detected:\n${violations.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${workflowFiles.length} workflow files; PR workflows have no secret references and push workflows have no workflow-level secret environment.`);
}
