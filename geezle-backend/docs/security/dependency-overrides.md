# Security dependency overrides

These targeted overrides keep the Prisma CLI dependency chain on patched
versions without changing Prisma's major version. They are intentionally
scoped and should be removed when their upstream parent dependencies accept
patched ranges.

| Override | Advisory / reason | Removal condition |
| --- | --- | --- |
| `@fastify/busboy@3.2.2` | Fixes GHSA-xjh9-v7x6-24jw, GHSA-x8mw-p69m-v3mx, and GHSA-gxm5-99cw-xjw9. It is within the existing Firebase Admin dependency range. | Remove after the lockfile resolves a parent-supported version at or above `3.2.2`. |
| `@prisma/config` => `deepmerge-ts@^8.0.1` | GHSA-ggr8-5vv4-36mx affects the exact `deepmerge-ts@7.1.5` pin in `@prisma/config@7.10.0`. Version 8 adds cycle/depth handling for recursive graphs. | Remove after the Prisma config package accepts `deepmerge-ts@8` or later; retain Prisma CLI validation when changing it. |
| `prisma` => `mysql2@3.23.1` | Prisma 7.10.0 pins `mysql2@3.15.3`. This override addresses GHSA-3f6p-5ww8-9rcr and GHSA-rgwj-5xj2-c3m3 without changing Prisma's version. | Remove after Prisma resolves `mysql2@3.23.1` or later; retain the CLI/schema validation when changing it. |

The production runtime Dockerfiles also remove Prisma CLI/config, `mysql2`, and
`deepmerge-ts` from the final image. The Prisma overrides therefore protect
build and database-maintenance tooling; they do not add MySQL support to the
PostgreSQL application runtime.
