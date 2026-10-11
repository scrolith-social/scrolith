# PR #156 CI security review record

**Snapshot date:** 2026-10-10
**Purpose:** Track independent-review findings; this is not a risk acceptance or a dependency-upgrade approval.
**Evidence:** [Independent review](https://github.com/geezlesocial/scrolith/pull/156#pullrequestreview-5479249020), GitHub Actions run [38057102491](https://github.com/geezlesocial/scrolith/actions/runs/38057102491), plus a read-only lockfile audit against the public npm registry and OSV advisory records on the snapshot date.

## Dependency audit findings

The recorded and locally reproduced audit totals match:

| Scope | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Production tree (`npm audit --omit=dev`) | 1 | 7 | 31 | 1 | 40 |
| Full lockfile (`npm audit`) | 2 | 44 | 34 | 3 | 83 |

Both audit commands exit nonzero because findings exist. A green workflow only proves the audit command ran and reported these counts; it does not mean the findings passed a security threshold. The lockfile was not changed. No package install or upgrade was performed.

In the inventory below, production means the package is included by npm's `--omit=dev` audit; it does not prove that a vulnerable code path is reachable in the deployed service. “Direct” and “transitive” are npm's audit classifications. Versions are the locked versions in `package-lock.json`. For inherited findings, the advisory is attached to the named dependency chain, not necessarily to each listed parent package. Severity in the tables is npm's aggregate package severity; where a package has multiple advisories, their individual severities are stated below. Advisory patch versions are OSV's first fixed versions as queried on the snapshot date; they are candidates for compatibility review, not an instruction to upgrade.

For every row, **owner is unassigned** (backend maintainer must assign); **temporary risk acceptance: none recorded**; and **exploitability/applicability to Scrolith: not assessed**. Priorities are P0 for Critical, P1 for High, P2 for Moderate, and P3 for Low. Critical and High findings remain production-release blockers until fixed or formally risk-accepted under release policy.

### Critical

| Package and locked version | Scope / type | Advisory and candidate fixed version | Compatibility / follow-up |
| --- | --- | --- | --- |
| `proxy-addr@2.0.7` | Production, transitive | [GHSA-jqcg-44mw-7w3h](https://osv.dev/vulnerability/GHSA-jqcg-44mw-7w3h); `2.0.8` | P0. Verify Express/proxy trust behavior and regression tests. |
| `handlebars@4.7.9` | Development, transitive | Critical: [GHSA-8r5x-fm3f-whwj](https://osv.dev/vulnerability/GHSA-8r5x-fm3f-whwj), [GHSA-p8wg-vrv2-v86f](https://osv.dev/vulnerability/GHSA-p8wg-vrv2-v86f). Also Moderate: [GHSA-xw65-4hp5-5hc7](https://osv.dev/vulnerability/GHSA-xw65-4hp5-5hc7). Candidate `4.7.10` | P0. Confirm build/test consumers and test template behavior. |

### High

| Package(s) and locked version(s) | Scope / type | Advisory and candidate fixed version | Compatibility / follow-up |
| --- | --- | --- | --- |
| `@fastify/busboy@3.2.0` | Production, transitive | High: [GHSA-xjh9-v7x6-24jw](https://osv.dev/vulnerability/GHSA-xjh9-v7x6-24jw), [GHSA-x8mw-p69m-v3mx](https://osv.dev/vulnerability/GHSA-x8mw-p69m-v3mx). Moderate: [GHSA-gxm5-99cw-xjw9](https://osv.dev/vulnerability/GHSA-gxm5-99cw-xjw9). Candidate `3.2.2` covers the listed ranges | P1. Exercise multipart parsing and upload compatibility. |
| `compression@1.8.1` | Production, direct | [GHSA-vc2v-76pw-4v95](https://osv.dev/vulnerability/GHSA-vc2v-76pw-4v95); `1.8.2` | P1. Regression-test compressed responses and disconnect handling. |
| `@prisma/config@7.10.0`, `deepmerge-ts@7.1.5`, `mysql2@3.15.3`, `prisma@7.10.0` | Production tree; transitive except direct `prisma` | High: [GHSA-ggr8-5vv4-36mx](https://osv.dev/vulnerability/GHSA-ggr8-5vv4-36mx) (`deepmerge-ts@8.0.0`); High: [GHSA-3f6p-5ww8-9rcr](https://osv.dev/vulnerability/GHSA-3f6p-5ww8-9rcr) (`mysql2@3.22.0` or later in the fixed range). Moderate: [GHSA-rgwj-5xj2-c3m3](https://osv.dev/vulnerability/GHSA-rgwj-5xj2-c3m3) (`mysql2@3.23.1`) | P1. npm's aggregate fix suggestion is `prisma@6.19.3`, a major downgrade from Prisma 7; it is not approved. A compatible Prisma 7 remediation is unverified. Resolve the transitive graph with Prisma-owner review and migration/client regression tests. |
| `sharp@0.35.4` | Production, direct | [GHSA-wq5f-xc86-pv6w](https://osv.dev/vulnerability/GHSA-wq5f-xc86-pv6w); `0.35.5` | P1. Verify native binary/platform and image-processing behavior. |
| `@types/jest@29.5.14` | Development, direct | Inherited Jest 29 dependency chain; npm suggests `@types/jest@30.0.0` | P1. Major type/API change; migrate and compile all tests before acceptance. |
| `jest@29.7.0` (direct) and `@jest/console`, `@jest/core`, `@jest/environment`, `@jest/expect`, `@jest/fake-timers`, `@jest/globals`, `@jest/reporters`, `@jest/test-result`, `@jest/test-sequencer`, `@jest/transform`, `babel-jest`, `create-jest`, `expect`, `jest-circus`, `jest-cli`, `jest-config`, `jest-environment-node`, `jest-haste-map`, `jest-message-util`, `jest-resolve`, `jest-resolve-dependencies`, `jest-runner`, `jest-runtime`, `jest-snapshot`, `jest-watcher` (transitive; all `29.7.0`) | Development | Aggregate package severity is High; inherited advisory severities are mixed Moderate/High and are linked in the `brace-expansion`, `braces`, `minimatch`, and `picomatch` rows. npm suggests `jest@30.5.2`. | P1. Major test-runner migration; validate config, reporters, snapshots, and the complete suite. |
| `brace-expansion@1.1.12` | Development, transitive | Moderate: [GHSA-f886-m6hf-6m8v](https://osv.dev/vulnerability/GHSA-f886-m6hf-6m8v), [GHSA-q2hr-2g5m-vwhr](https://osv.dev/vulnerability/GHSA-q2hr-2g5m-vwhr). High: [GHSA-3jxr-9vmj-r5cp](https://osv.dev/vulnerability/GHSA-3jxr-9vmj-r5cp), [GHSA-mh99-v99m-4gvg](https://osv.dev/vulnerability/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://osv.dev/vulnerability/GHSA-rgw5-rvv9-x895), [GHSA-qhr7-859c-m2p7](https://osv.dev/vulnerability/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://osv.dev/vulnerability/GHSA-6j4f-fj2g-mc7p). Candidate `1.1.21` covers the listed 1.x ranges | P1. Update through compatible parents, then run Jest and contract suites. |
| `braces@3.0.3`, `chokidar@3.6.0`, `ts-node-dev@2.0.0` (direct `ts-node-dev`; other entries transitive) | Development | [GHSA-vfj7-8cjw-p6xm](https://osv.dev/vulnerability/GHSA-vfj7-8cjw-p6xm) applies to `braces`; the current OSV record supplied no fixed event. npm reports no fix for `chokidar` / `ts-node-dev`; it suggests a major Jest update for the `braces` chain. | P1. No compatible fix established. Identify maintained replacements/parents; do not suppress or force-upgrade. |
| `browserslist@4.28.1` | Development, transitive | [GHSA-c83g-rgw3-j3cx](https://osv.dev/vulnerability/GHSA-c83g-rgw3-j3cx), [GHSA-73wf-gq98-2v4g](https://osv.dev/vulnerability/GHSA-73wf-gq98-2v4g); `4.28.7` | P1. Verify browser target data and build output. |
| `form-data@4.0.5` | Development, transitive | [GHSA-hmw2-7cc7-3qxx](https://osv.dev/vulnerability/GHSA-hmw2-7cc7-3qxx); `4.0.6` | P1. Validate multipart client behavior and its parent dependency. |
| `js-yaml@3.14.2` | Development, transitive | Moderate: [GHSA-h67p-54hq-rp68](https://osv.dev/vulnerability/GHSA-h67p-54hq-rp68). High: [GHSA-52cp-r559-cp3m](https://osv.dev/vulnerability/GHSA-52cp-r559-cp3m), [GHSA-5p4m-2wfm-xmqj](https://osv.dev/vulnerability/GHSA-5p4m-2wfm-xmqj), [GHSA-2883-xcg3-v3hh](https://osv.dev/vulnerability/GHSA-2883-xcg3-v3hh). `3.15.2` is the listed 3.x candidate | P1. Validate YAML-consuming tools and CI configuration. |
| `minimatch@3.1.2` | Development, transitive | [GHSA-3ppc-4f35-3m26](https://osv.dev/vulnerability/GHSA-3ppc-4f35-3m26), [GHSA-7r86-cg39-jmmj](https://osv.dev/vulnerability/GHSA-7r86-cg39-jmmj), [GHSA-23c5-xmqv-rm74](https://osv.dev/vulnerability/GHSA-23c5-xmqv-rm74); `3.1.4` | P1. Resolve via compatible parent constraints and test glob-based selection. |
| `picomatch@2.3.1` | Development, transitive | Moderate: [GHSA-3v7f-55p6-f55p](https://osv.dev/vulnerability/GHSA-3v7f-55p6-f55p). High: [GHSA-c2c7-rcm5-vvqj](https://osv.dev/vulnerability/GHSA-c2c7-rcm5-vvqj). Candidate `2.3.2` | P1. Resolve through parent dependencies and test glob behavior. |
| `micromatch@4.0.8` | Development, transitive | Inherited through `braces`; npm suggests the major Jest 30 update as an aggregate route. | P1. Determine the compatible parent-level fix and test pattern matching. |

### Moderate

| Package(s) and locked version(s) | Scope / type | Advisory and candidate fixed version | Compatibility / follow-up |
| --- | --- | --- | --- |
| `@google-cloud/firestore@7.11.6`, `gaxios@6.7.1`, `google-gax@4.6.1`, `retry-request@7.0.2`, `teeny-request@9.0.0` | Production, transitive | Inherited via Google client dependencies and [GHSA-w5hq-g745-h8pq](https://osv.dev/vulnerability/GHSA-w5hq-g745-h8pq) (`uuid`). npm's aggregate suggestion includes `firebase-admin@14.5.0` (major) for the Firestore chain. | P2. Determine each actual dependency path and whether a patched compatible release exists; run cloud-client contract tests without connecting to cloud services. |
| `@google-cloud/storage@7.19.0` | Production, direct | Inherited through `retry-request`, `teeny-request`, and [GHSA-w5hq-g745-h8pq](https://osv.dev/vulnerability/GHSA-w5hq-g745-h8pq) (`uuid`). Audit reports a compatible fix but no exact target. | P2. Do not infer that the package itself is vulnerable solely from its parent chain; inspect updated lock resolution before selecting a version. |
| `@jimp/core`, `@jimp/diff`, `@jimp/js-bmp`, `@jimp/js-gif`, `@jimp/js-jpeg`, `@jimp/js-png`, `@jimp/js-tiff`, `@jimp/plugin-blur`, `@jimp/plugin-color`, `@jimp/plugin-contain`, `@jimp/plugin-cover`, `@jimp/plugin-crop`, `@jimp/plugin-hash`, `@jimp/plugin-print`, `@jimp/plugin-resize`, `@jimp/plugin-rotate`, `@jimp/plugin-threshold` (all `1.6.0`, transitive) and `jimp@1.6.0` (direct) | Production | Inherited from [GHSA-5v7r-6r5c-r473](https://osv.dev/vulnerability/GHSA-5v7r-6r5c-r473) affecting `file-type`; listed fixed version `file-type@21.3.1` | P2. Major file-type generation change may not fit current Jimp constraints; validate image formats and processing pipelines. |
| `body-parser@1.20.4` (transitive), `express@4.22.1` (direct), `qs@6.14.1` (transitive) | Production | Low: [GHSA-v422-hmwv-36x6](https://osv.dev/vulnerability/GHSA-v422-hmwv-36x6) (`body-parser@1.20.6`); Low: [GHSA-w7fw-mjwx-w883](https://osv.dev/vulnerability/GHSA-w7fw-mjwx-w883); Moderate: [GHSA-q8mj-m7cp-5q26](https://osv.dev/vulnerability/GHSA-q8mj-m7cp-5q26), [GHSA-4mjr-xmp4-gh2g](https://osv.dev/vulnerability/GHSA-4mjr-xmp4-gh2g). `qs@6.16.0` covers the listed ranges | P2. Test request limits, query parsing, and Express compatibility. |
| `file-type@16.5.4` | Production, transitive | [GHSA-5v7r-6r5c-r473](https://osv.dev/vulnerability/GHSA-5v7r-6r5c-r473); `21.3.1` | P2. Major version; assess parent compatibility and supported formats. |
| `firebase-admin@13.10.0` | Production, direct | Inherited through `@google-cloud/firestore`; npm suggests `14.5.0` (major). | P2. Major upgrade; validate authentication, Firestore, and initialization behavior using local stubs. |
| `node-cron@3.0.3` | Production, direct | Inherited through the `uuid` finding; npm suggests `4.6.0` (major). | P2. Review schedule/time-zone semantics and test job registration before upgrade. |
| `uuid@8.3.2`, `uuid@9.0.1`, `uuid@13.0.0` | Production, direct | [GHSA-w5hq-g745-h8pq](https://osv.dev/vulnerability/GHSA-w5hq-g745-h8pq); `13.0.1` is listed for the affected 13.x line. | P2. Audit reports multiple installed lines; determine which versions match the advisory range and parent constraints before changing. |
| `baseline-browser-mapping@2.9.17` | Development, transitive | [GHSA-w5vr-8v7q-w6rv](https://osv.dev/vulnerability/GHSA-w5vr-8v7q-w6rv); `2.11.0` | P2. Check compatibility with the browser data consumer. |
| `argparse@1.0.10`, `sprintf-js@1.0.3` | Development, transitive | [GHSA-hp3w-g68c-fv3c](https://osv.dev/vulnerability/GHSA-hp3w-g68c-fv3c) affects `sprintf-js`; OSV supplied no fixed event. `argparse` is inherited through this chain. | P2. Exact patched version not established. Identify whether the vulnerable formatting path receives untrusted input. |

### Low

| Package and locked version | Scope / type | Advisory and candidate fixed version | Compatibility / follow-up |
| --- | --- | --- | --- |
| `@tootallnate/once@2.0.0` | Production, transitive | [GHSA-vpq2-c234-7xj6](https://osv.dev/vulnerability/GHSA-vpq2-c234-7xj6); `2.0.1` | P3. Resolve through parent and test timeout/control-flow use. |
| `@babel/core@7.28.6` | Development, transitive | [GHSA-4x5r-pxfx-6jf8](https://osv.dev/vulnerability/GHSA-4x5r-pxfx-6jf8); `7.29.6` | P3. Validate Babel build and transform output. |
| `diff@4.0.2` | Development, transitive | [GHSA-73rr-hh4g-fpgx](https://osv.dev/vulnerability/GHSA-73rr-hh4g-fpgx); `4.0.4` | P3. Resolve through the parent and test patch parsing. |

### Triage and release disposition

- No exploitability, exposed-input, or runtime reachability assessment is recorded. Package presence and severity alone do not establish exploitability; they also do not establish safety.
- Every package row has no assigned remediation owner. The backend maintainer must assign owners and track dependency-path fixes.
- No temporary risk acceptance is recorded. No Critical/High item is accepted for production release by this document.
- Do not run `npm audit fix --force`. The aggregate suggestions include major upgrades and a Prisma 7-to-6 downgrade. Apply fixes in separately reviewed dependency work with lockfile diff, Prisma/client compatibility checks, and full regression validation.
- The exact fix candidates above are advisory metadata, not proof that the candidate is compatible with Scrolith or resolves every duplicate lockfile path. Re-run both audits after any dependency change.

## Legacy integration coverage comparison

The historical workflow content at base `32f49c2d6b3b38551cea4855b1bab7aa15fba7ca` targeted `main`/`master`, installed both root and backend dependencies, tolerated Prisma generation/migration/seed failures, started a backend, waited for `/api/health`, ensured a seeded admin existed, ran `npx jest tmp/adminProfileBroadcast.test.cjs`, and uploaded test logs. The referenced `tmp/` target was absent from the tracked backend test tree and `tmp/` is not a maintained test location.

| Legacy purpose | Prisma 7 Verification replacement | Equivalent? | Gap / implication |
| --- | --- | --- | --- |
| Install backend dependencies and prepare Prisma | Backend `npm ci`, Prisma validate/generate, isolated migration deploy/status/diff | Yes, for the backend source line; failures are not swallowed | No frontend package is installed or tested here, intentionally. |
| Database and Redis availability | Loopback-bound disposable PostgreSQL and Redis services with generated test-only credentials | Yes for isolated CI service readiness | Does not establish production service health. |
| Apply schema and create fixtures | Strict checked-in migrations and deterministic test fixture seed | Partial | The old workflow used permissive fallbacks and potentially live secrets; the new workflow deliberately does not recreate that unsafe behavior or promise a production admin identity. |
| Start backend and check `/api/health` | Build final Docker artifact and verify runtime `/api/health` returns 200 with disposable dependencies | Yes for startup health | Does not exercise authenticated admin profile behavior. |
| Ensure an admin exists and test profile broadcast | The old `tmp/adminProfileBroadcast.test.cjs` target remains absent. A maintained positive-path integration test is now added to `src/__tests__/integration/socket.integration.test.ts`; the full Jest runner executes this file as its own group. It uses a synthetic admin, a real root-namespace Socket.IO client, and the disposable CI database. | **Partial** | It verifies the authenticated PUT response and current event payload shapes on the root namespace. It does not establish frontend namespace parity, event audience isolation, non-admin denial, credential redaction, or unauthorized no-side-effects. Those remain separate security blockers and require a confirmed contract plus application remediation. |
| Preserve test logs as an artifact | New runtime step emits sanitized container diagnostics only on smoke failure; no passing test log artifact | No, intentionally narrower | Avoids routine artifact collection of potentially sensitive logs; CI step summaries remain the source of pass/fail evidence. |
| Validate PRs to `main`/`master` | PR and push validation target literal `backend/main` | No, by design | Backend source is maintained separately. Do not redirect backend checks to frontend `main`; repository owners must maintain the branch relationship explicitly. |

The positive admin-profile broadcast scenario is now represented by the maintained test above, rather than by the obsolete `tmp/` path. Its scope is deliberately limited to the current success path and root namespace, because the route emits with `io.emit()`. It is not evidence that the route is properly authorized or that events are private: the current route uses authentication middleware but no admin-role middleware, emits `user:profile_updated` both to the user room and globally, and emits `admin:profile_updated` globally as well as to the `admins` room. The test does not establish whether the maintained frontend subscribes to the root namespace. A backend/security owner must confirm the intended contract and separately remediate and test those authorization, recipient, namespace, and redaction behaviors. Do not read the positive-path test as acceptance of the current global broadcasts.

## CI security controls verified in this proposal

- `prisma7-verification.yml` runs on pull requests and pushes to `backend/main`; the existing historical push branch remains configured.
- The test service credentials are generated from GitHub run identifiers and the services are local disposable PostgreSQL/Redis. The workflow has `contents: read`, recursive checkout with `persist-credentials: false`, and no deployment job or cloud credentials.
- `check-pr-workflow-secrets.mjs` is run from the repository root as a mandatory step, followed by its positive/negative Node tests. A nonzero checker or test exit fails the job.
- The checker is a static guardrail, not a proof that a human review or environment protection is configured. It rejects any secret reference in a PR- or push-triggered workflow file, including job-scoped references. A deployment workflow that needs credentials must be separate from push-triggered workflows and still needs its own event, job-condition, environment, and permission review. Current root workflows contain no secret references in this audit.
- No dependency findings were suppressed or upgraded by this CI proposal. The audit steps remain informational so the workflow can report the full inventory; release blockers remain tracked above.

## 2026-10-11 independent-review follow-up

### Related security fixes and review scope

The following separate draft PRs have independent scoped code-review decisions. Their approvals are not merge approval or production-release authorization:

| PR | Reviewed head | Review evidence | Scope and current state |
| --- | --- | --- | --- |
| [#157 proxy-addr Critical fix](https://github.com/geezlesocial/scrolith/pull/157) | `d9b1377da623da2a147f50658930b626ef54df57` | [Independent APPROVED review](https://github.com/geezlesocial/scrolith/pull/157#pullrequestreview-5483323146) | `proxy-addr` 2.0.7 → 2.0.8 and the focused proxy-trust regression. Open, draft, unmerged. |
| [#158 High dependency fixes](https://github.com/geezlesocial/scrolith/pull/158) | `3a37e5399f053fae84becfcc1fa0bae2841ae55b` | [Independent APPROVED review](https://github.com/geezlesocial/scrolith/pull/158#pullrequestreview-5483288388) | Compatible updates for `compression`, `sharp`, Firebase-scoped `@fastify/busboy`, `deepmerge-ts`, and `mysql2`; Prisma remains 7.10.0. Open, draft, unmerged. |

These reviewed changes are not present on `backend/main` while the PRs remain unmerged. The `backend/main` base is `32f49c2d6b3b38551cea4855b1bab7aa15fba7ca`. The PR #156 validation merge ref leaves the backend dependency manifest and lockfile unchanged, so its fresh audit is representative of that unmerged dependency baseline, not of the #157/#158 combined candidate.

### Do not conflate branch and combined-candidate audit results

| Source under review | Production audit (C/H/M/L) | Full audit (C/H/M/L) | Interpretation |
| --- | --- | --- | --- |
| `backend/main` base `32f49c2d6b3b38551cea4855b1bab7aa15fba7ca`, freshly reported by PR #156 validation run 38141736073 on 2026-10-11 | 1 / 7 / 31 / 1 | 2 / 44 / 34 / 3 | Unmerged dependency baseline; #157/#158 fixes are not included. The CI validation merge ref has no dependency-manifest or lockfile changes relative to this base. |
| Combined #156 + #157 + #158 candidate, [hosted run 38121207260](https://github.com/geezlesocial/scrolith/actions/runs/38121207260) | 0 / 0 / 31 / 1 | 1 / 37 / 34 / 3 | Candidate evidence only; not the state of `backend/main`. Both audit commands returned nonzero and the overall workflow concluded failure because findings remain. Functional checks in that run passed; the audit failures were not suppressed. |

The combined candidate's zero Critical/zero High production-scope count must not be described as the current production or `backend/main` dependency posture. The combined full-tree audit still reports one Critical and 37 High findings, so the full-tree security gate is not cleared.

### PR #156 validation result

[Prisma 7 Verification run 38141736073](https://github.com/geezlesocial/scrolith/actions/runs/38141736073), for PR #156 head `e92185be69f4c5b65297dd18fc3e9ee62cf0bd8b`, completed successfully. It used loopback-bound disposable PostgreSQL and Redis with generated test-only credentials. Secret-boundary checks, Prisma validation/generation, isolated migrations, deterministic fixture seeding, Node contract tests, TypeScript build, patch formatting, clean Docker build, and runtime `/api/health` (HTTP 200) all completed. Full Jest passed **203/203 suites and 1,286/1,286 tests**; the maintained `socket.integration.test.ts` group passed **6/6 tests**, including the new admin-profile positive-path test. The production and full audits reported the baseline totals in the table above; the workflow intentionally continues after reporting audit findings, so its successful conclusion is not a zero-vulnerability result.

### Remaining findings, accountability, and decisions

- The remaining full-tree Critical is the recorded development/test dependency finding for `handlebars` (including the advisories listed in the inventory above). The 37 remaining full-tree High findings are predominantly development/test dependency chains, including Jest/Babel and other toolchain packages; use the audit output and lockfile to maintain the package-level inventory rather than treating the count as 37 independent runtime exposures. The full audit is the evidence source; production-scope status is a separate measure.
- The earlier package inventory records no named remediation owners. Suggested accountable roles—not assigned people—are: backend dependency maintainer for production and shared transitive chains; test-infrastructure/Jest maintainer for test-only chains; and product/service owners to establish reachability and compatibility. A named security/release owner must own formal disposition, due dates, and any policy-compliant risk acceptance. No risk acceptance is recorded here.
- For the admin-profile route, the backend API/security owner and realtime/Socket.IO owner must confirm whether the endpoint updates the authenticated account, platform admin settings, or both, and define event recipients and payload fields. The current source is authenticated but does not apply admin-role authorization at this router; it has global profile emits. The new integration test covers only the authorized synthetic-admin success path and payload shape, not non-admin denial, event-recipient isolation, credential redaction, or no-side-effect behavior. Those are unresolved product-security findings, not silently accepted by adding a passing test.
- The CI maintainer owns keeping this test on the disposable PostgreSQL/Redis validation path and ensuring it remains in the isolated Jest group. The current `npm run test:full` runner isolates `src/__tests__/integration/socket.integration.test.ts`; the new test is discovered by that maintained suite. CI uses generated test credentials and loopback-bound disposable services; no production secret or deployed database is used.
- The release/security authority still needs to determine whether unresolved full-tree findings block merge of a CI-only PR separately from production release, what evidence is required for applicability/risk disposition, and whether the release gate requires a fresh production-scope audit after #157/#158 are merged. This record proposes no exception and does not authorize merge or deployment.
- The schema-to-migration discrepancy and other release gates remain separate unresolved items. Neither the scoped reviews of #157/#158 nor the combined candidate run resolves them.
