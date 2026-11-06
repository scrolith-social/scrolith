# Scrolith

Scrolith is a professional community and work platform. This repository contains the React web client, an Express API used by the application, shared Prisma data models, and Electron desktop packaging. The source includes social and professional networking, jobs and freelance work, marketplace and commerce, messaging, wallet, administrative, and AI-related areas. Availability of a capability depends on its server implementation, account permissions, deployment configuration, and any required third-party provider; code presence alone is not a production-readiness guarantee.

> **Repository status:** This README describes the code at the repository's current `main` branch. It is a software-development guide, not a deployment authorization, security certification, or claim that every listed integration is enabled in production.

## Repository

- Canonical repository: [scrolith-social/scrolith](https://github.com/scrolith-social/scrolith)
- Default branch: `main`
- Backend integration work may use the separately maintained `backend/main` branch. Do not assume it is interchangeable with `main` or merge the two histories wholesale.

## What is in this repository

| Area | Location | Technology / purpose |
|---|---|---|
| Web application | `src/`, `components/`, `dashboard/`, `routes/`, `public/` | React, TypeScript, Vite, responsive browser UI |
| API service | `server/src/` | Express, TypeScript, REST-style `/api/*` routes, Socket.IO server setup |
| Data model and migrations | `server/prisma/` | Prisma schema, SQLite development datasource, migrations, seed script |
| Desktop packaging | `desktop/` and root `package.json` | Electron packaging for Windows installer and portable artifacts |
| Browser and UI tests | `tests/`, `cypress/`, `playwright.config.*`, `cypress.config.ts` | Unit, certification, Cypress, and Playwright test infrastructure |
| Operational documentation | `docs/`, `manual_backend_setup.md`, `SECURE_SECRETS.md` | Feature, operations, hosting, and security guidance; check each document's scope and date before use |
| Compatibility / legacy files | `geezle-backend/` | Limited PHP/Laravel-oriented files; not launched by the root npm scripts |

The root package retains the internal package name `atmyworks`; the product and desktop display name are Scrolith. Treat the root lockfile and package scripts as authoritative for this checkout.

### Product areas represented in source

The web and API source includes routes and components for:

- Account access and user profiles.
- Professional networking, community posts, and messaging.
- Job listings, freelance gigs, proposals, contracts, and work tracking.
- Marketplace browsing and commerce/order flows.
- Wallet, finance, and withdrawal-related interfaces and API modules.
- Administrative, CMS, moderation, and platform-management tools.
- KYC-related workflows and AI/search or market-intelligence modules.

These are source-code areas, not a promise that every workflow is enabled, integrated with a live provider, or approved for real-money use. Provider credentials, server-side feature gates, database state, regional settings, and independent release approvals may be required.

## Architecture at a glance

```text
Browser / Electron shell
        │
        ├── Vite + React + TypeScript web client
        │       └── API clients and Socket.IO client
        │
        └── Express + TypeScript service (`server/src`)
                ├── `/api/auth`, `/api/admin`, `/api/cms`
                ├── `/api/jobs`, `/api/gigs`, `/api/commerce`
                ├── `/api/messages`, `/api/orders`, `/api/contracts`
                ├── `/api/wallet`, `/api/finance`, `/api/withdrawal`, `/api/kyc`
                └── Prisma data access (`server/prisma`)
```

The API exposes a health route at `/api/health`. The server uses `PORT` when supplied and otherwise listens on port `5000`. The Prisma schema in this branch configures SQLite with a file datasource. Do not infer PostgreSQL production behavior from this local schema or from documentation about other Scrolith branches/services.

## Requirements

- Git.
- Node.js and npm. Current repository CI uses Node.js 18 for the main build; the desktop release workflow uses Node.js 22. Node.js 22 LTS is a suitable local choice, subject to the lockfile and workflow requirements.
- A supported Windows environment for the current NSIS/portable desktop packaging scripts.
- No external database is needed for a static frontend build. The local API's Prisma operations require its SQLite schema/client to be generated and a suitable local database file.

Check workflow files and the lockfile before changing Node or package versions.

## Get the source

```bash
git clone https://github.com/scrolith-social/scrolith.git
cd scrolith
git checkout main
```

This branch does not declare a Git submodule in `.gitmodules`; do not use recursive-submodule instructions copied from older repository layouts.

## Install and run locally

Install the root dependencies from the committed lockfile:

```bash
npm ci
```

Run the web client:

```bash
npm run dev
```

In another terminal, run the API service:

```bash
npm run server
```

The Vite development server and API origins can vary by local configuration. Set `VITE_BACKEND_URL` (or the applicable `VITE_API_BASE_URL` / `VITE_API_URL` setting used by the relevant client) to the intended local API origin. Do not point a development build at production by accident. The API's default port is `5000`; inspect `vite.config.ts` and the relevant API client when changing proxy or port settings.

### Database safety

The Prisma datasource in `server/prisma/schema.prisma` is SQLite and points to `server/prisma/dev.db` relative to that schema. This repository currently tracks that database file. **Do not run migrations, seed scripts, or tests that write data against the tracked database or any database containing owner data.** For database-changing work, use a disposable copy/checkout with a separate database file and verify the effective datasource before running commands. Do not use `prisma migrate reset` or `prisma db push` as a setup shortcut.

In an isolated disposable copy, Prisma commands should specify the schema explicitly:

```bash
npx prisma generate --schema server/prisma/schema.prisma
npx prisma migrate dev --schema server/prisma/schema.prisma
npx prisma db seed --schema server/prisma/schema.prisma
```

The migration and seed commands write data. Run them only after positively verifying that the copy and its SQLite database are disposable. The root shortcut `npm run db:migrate` does not include an explicit schema path; prefer the explicit command above until that script is verified for the current checkout.

## Configuration and secrets

Configuration is feature-specific. Relevant names used in source include:

- API origin: `VITE_BACKEND_URL`, `VITE_API_BASE_URL`, `VITE_API_URL`, and mobile-oriented API URL variables.
- Service listener: `PORT`.
- Optional AI/provider integrations: server-side variables such as `OPENAI_API_KEY` and `GEMINI_API_KEY`.
- Test/certification configuration: `CERT_*` and `SCROLITH_CERT_*` variables.

The checked-in root `.env.example` is currently empty. Consult the feature's source and maintained setup documentation for required configuration; do not assume an empty template is a complete deployment configuration.

**Never commit secrets.** Keep database credentials, signing keys, OAuth client secrets, provider keys, and test passwords in an approved local secret store or environment configuration. Any variable prefixed with `VITE_` is bundled for browser use and must be treated as public; never place a private credential in it. Use synthetic accounts and credentials for local tests.

## Build and tests

Common root commands:

```bash
npm run build
npm run preview
npm run test:cert:unit
npm run test:mobile:unit
```

The repository also defines browser and release-oriented tests:

```bash
npm run test:cert:e2e
npm run test:cert:e2e:all-mobile
npm run test:cert:identity
npm run test:cert:gate
```

Browser certification may require a running local application, browser binaries, a deliberately configured local API, and synthetic test identities. Before running it, inspect the selected Playwright config and verify its base URLs and credentials cannot reach production or staging. Do not interpret a skipped or unauthenticated test run as proof of authenticated behavior.

For an isolated unit check without the browser certification suite:

```bash
npm run test:cert:unit
npm run test:mobile:unit
```

For desktop packaging on Windows:

```bash
npm run desktop:dist
```

This generates local artifacts under the configured desktop output directory. It does not publish or deploy them. Release signing and distribution require separately approved credentials and release procedures.

## Desktop and mobile

The root package contains Electron desktop packaging configuration and Windows NSIS/portable build scripts. It also declares Capacitor-related packages, but this `main` revision does not contain tracked `android/`, `ios/`, or `capacitor.config.*` native-project files. Therefore, dependency presence alone does not mean Android or iOS applications can be built from this checkout. Native mobile build support must be verified from the exact approved mobile source/branch and its CI workflow before release claims are made.

## Deployment and release

Deployment is not performed by the local commands in this README. Review the applicable, current deployment runbook and workflow for the exact service, branch, image, environment, and release authorization. Some repository workflows support build, artifact, or deployment operations; inspect their triggers and protection settings before dispatching them. Do not run a production deployment, publish an image, apply a production migration, change DNS/secrets/identity settings, or shift traffic without explicit owner authorization and a verified rollback plan.

Existing operational documents can be discovered under `docs/`. Documentation may describe other branches, historical releases, or specific cloud targets; verify its current applicability before following it.

## Security and responsible development

- Keep authorization checks in backend routes/controllers; frontend visibility is not access control.
- Validate input on the server and use the established moderation, audit, and idempotency mechanisms for state-changing operations.
- Do not put secrets in source, browser bundles, screenshots, logs, issues, or pull-request output.
- Use only fresh disposable databases for tests that write data.
- Do not run wallet, payment, payout, or other financial flows with live credentials during development.
- Preserve feature hard-disable defaults unless a separately reviewed and authorized release explicitly changes them.
- Treat API compatibility, database migrations, provider integrations, and production behavior as requiring their own tests and review.

## Contributing

1. Start from the correct maintained branch (`main` for the web application, or the explicitly designated backend/mobile branch for that work).
2. Create a focused feature branch and keep unrelated local changes out of the patch.
3. Review the full diff, including untracked files, before staging.
4. Run the narrow tests first, followed by applicable build and regression checks.
5. Use an independently reviewable pull request and wait for required CI and approvals.
6. Do not merge, publish, deploy, migrate, or change traffic outside the applicable authorization process.

## Known repository-specific cautions

- The root package uses legacy internal metadata (`atmyworks`) while the product/desktop name is Scrolith.
- The SQLite development database is tracked; do not treat it as a disposable test database.
- The root `.env.example` is empty at this revision.
- The root npm scripts include a Prisma migration shortcut without an explicit schema argument; use explicit schema paths only in a verified disposable copy.
- Capacitor packages are present, but native Android/iOS project directories are absent from this revision.
- No root `LICENSE` file is present. Do not assume this repository grants permission to redistribute or commercially reuse its source or assets.

## License and assets

No repository-level license is included in this revision. All rights remain with their respective owners unless a separate written license or asset grant applies. Review dependency licenses and asset ownership before redistribution or commercial reuse.
