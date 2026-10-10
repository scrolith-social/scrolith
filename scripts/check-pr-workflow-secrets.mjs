import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDirectory = path.join(repositoryRoot, '.github', 'workflows');
const secretReference = /\$\{\{\s*secrets\./i;

const hasEventTrigger = (source, eventName) => {
  const blockTrigger = new RegExp(`^\\s{2}${eventName}\\s*:`, 'm');
  const inlineTrigger = new RegExp(`^on:\\s*(?:\\[[^\\]]*\\b${eventName}\\b[^\\]]*\\]|${eventName}\\s*(?:#.*)?)$`, 'm');
  return blockTrigger.test(source) || inlineTrigger.test(source);
};

export function findSecretBoundaryViolations(workflows) {
  const violations = [];

  for (const { filename, source } of workflows) {
    if ((hasEventTrigger(source, 'pull_request') || hasEventTrigger(source, 'pull_request_target')) && secretReference.test(source)) {
      violations.push(`${filename}: secret reference in PR-triggered workflow`);
    }

    if (hasEventTrigger(source, 'push') && secretReference.test(source)) {
      violations.push(`${filename}: secret reference in push-triggered workflow`);
    }
  }

  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workflowFiles = fs.readdirSync(workflowsDirectory)
    .filter((name) => /\.ya?ml$/i.test(name));
  const workflows = workflowFiles.map((filename) => ({
    filename,
    source: fs.readFileSync(path.join(workflowsDirectory, filename), 'utf8')
  }));
  const violations = findSecretBoundaryViolations(workflows);

  if (violations.length > 0) {
    console.error(`Unsafe workflow secret scope detected:\n${violations.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`Checked ${workflowFiles.length} workflow files; PR- and push-triggered workflows have no secret references.`);
  }
}
