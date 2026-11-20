import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt', '.xml']);
const SENSITIVE_MARKERS = [
  ['stripe-secret', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['stripe-webhook-secret', /\bwhsec_[A-Za-z0-9]{16,}\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
];
// React Router and Axios ship a non-network browser/worker base-URL fallback
// for URL parsing when no browser location exists. These exact dependency
// literals are not application API destinations. Keep this exception limited
// to the generated router/vendor chunks, and reject the same literal in app
// chunks or any loopback URL with a path, port, query, or fragment.
const isKnownInertLoopbackFallback = (url, artifactPath) =>
  url === 'http://localhost' &&
  /^assets\/(?:router|vendor)-[A-Za-z0-9_-]+\.js$/.test(artifactPath.replace(/\\/g, '/'));
const isValidHost = (host) =>
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) ||
  isIP(host) !== 0;

async function collectTextFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTextFiles(path));
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files;
}

export async function inspectFrontendArtifact(directory, expectedApiHost, forbiddenApiHosts = []) {
  const normalizedHost = String(expectedApiHost || '').trim().toLowerCase();
  if (!isValidHost(normalizedHost)) {
    throw new Error('Expected API host is missing or invalid.');
  }
  const forbiddenHosts = new Set(
    forbiddenApiHosts.map((host) => String(host).trim().toLowerCase()).filter(Boolean)
  );
  if ([...forbiddenHosts].some((host) => !isValidHost(host))) {
    throw new Error('Forbidden API host list contains an invalid hostname.');
  }

  const files = await collectTextFiles(directory);
  if (!files.length) throw new Error('Build artifact contains no inspectable text files.');

  const findings = [];
  const hosts = new Set();
  const forbiddenHostsFound = new Set();
  const forbiddenHostFiles = new Map();
  const inertLoopbackFallbacks = [];
  let expectedApiHostFound = false;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (text.toLowerCase().includes(normalizedHost)) expectedApiHostFound = true;
    for (const [category, pattern] of SENSITIVE_MARKERS) {
      if (pattern.test(text)) findings.push({ file: relative(directory, file), category });
    }
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>`\\)\]}]+/gi)) {
      try {
        const hostname = new URL(match[0]).hostname.toLowerCase().replace(/^\[|\]$/g, '');
        const artifactPath = relative(directory, file).replace(/\\/g, '/');
        if (forbiddenHosts.has(hostname) && isKnownInertLoopbackFallback(match[0], artifactPath)) {
          inertLoopbackFallbacks.push({ host: hostname, file: artifactPath });
          continue;
        }
        hosts.add(hostname);
        if (forbiddenHosts.has(hostname)) {
          forbiddenHostsFound.add(hostname);
          const filesForHost = forbiddenHostFiles.get(hostname) || new Set();
          filesForHost.add(artifactPath);
          forbiddenHostFiles.set(hostname, filesForHost);
        }
      } catch {
        // Ignore incomplete URL fragments emitted from templates or source maps.
      }
    }
  }

  return {
    fileCount: files.length,
    expectedApiHostFound,
    findings,
    forbiddenApiHostsFound: [...forbiddenHostsFound].sort(),
    inertLoopbackFallbacks,
    forbiddenApiHostFiles: Object.fromEntries(
      [...forbiddenHostFiles].map(([host, filesForHost]) => [host, [...filesForHost].sort()])
    ),
    hosts: [...hosts].sort()
  };
}

function getCliOptions(args) {
  const [directory, flag, expectedApiHost, forbiddenFlag, forbiddenHostsValue] = args;
  if (
    !directory ||
    flag !== '--expected-api-host' ||
    !expectedApiHost ||
    (forbiddenFlag && forbiddenFlag !== '--forbidden-api-hosts') ||
    (forbiddenFlag && !forbiddenHostsValue)
  ) {
    throw new Error('Usage: node verify-frontend-build-artifact.mjs <dist-directory> --expected-api-host <hostname> [--forbidden-api-hosts <hostname,...>]');
  }
  return {
    directory,
    expectedApiHost,
    forbiddenApiHosts: forbiddenHostsValue ? forbiddenHostsValue.split(',') : []
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { directory, expectedApiHost, forbiddenApiHosts } = getCliOptions(process.argv.slice(2));
    const result = await inspectFrontendArtifact(directory, expectedApiHost, forbiddenApiHosts);
    if (result.findings.length) {
      for (const finding of result.findings) {
        console.error(`Sensitive marker category=${finding.category} file=${finding.file}`);
      }
      process.exitCode = 1;
    } else if (result.forbiddenApiHostsFound.length) {
      for (const host of result.forbiddenApiHostsFound) {
        console.error(`Forbidden API host=${host} bundleFiles=${result.forbiddenApiHostFiles[host].join(', ')}`);
      }
      process.exitCode = 1;
    } else if (!result.expectedApiHostFound) {
      console.error(`Expected API host is absent from the bundle: ${expectedApiHost}`);
      process.exitCode = 1;
    } else {
      console.log(`Scanned ${result.fileCount} bundle files; expected API host is present; no known credential markers found.`);
      if (result.inertLoopbackFallbacks.length) {
        console.log(`Allowed ${result.inertLoopbackFallbacks.length} exact inert browser-library loopback fallback(s); no application API URL exception applied.`);
      }
      console.log(`URL hosts: ${result.hosts.join(', ') || '(none)'}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Bundle inspection failed.');
    process.exitCode = 1;
  }
}
