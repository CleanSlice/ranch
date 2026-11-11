# Contract: Configuration

What an operator sets. Every value is optional; with none of them set, nothing
is sent and nothing warns. The operator's guide is
`docs/operations/error-tracking.md`.

## Runtime

| Variable | Read by | Where the value lives | Effect |
|----------|---------|-----------------------|--------|
| `SENTRY_DSN` | api | cluster secret `ranch-error-tracking`, key `API_SENTRY_DSN` | destination of the API project; empty = off |
| `SENTRY_INSTALLATION` | api | deployment env, optional | installation label; defaults to the host of `PUBLIC_API_URL` |
| `NUXT_PUBLIC_SENTRY_DSN` | admin | same secret, key `ADMIN_SENTRY_DSN` | destination of the Admin project; empty = off |
| `NUXT_PUBLIC_SENTRY_DSN` | app | same secret, key `APP_SENTRY_DSN` | destination of the App project; empty = off |

Every deployment references its key with `optional: true`. A cluster without
`ranch-error-tracking` starts normally.

Already present and reused, not introduced: `RANCH_VERSION`, `PUBLIC_API_URL`.

## When a project reports

| Project | Reports when |
|---------|--------------|
| api | it runs from a built image — `RANCH_VERSION` set and not `dev` — and has a DSN |
| admin, app | it is a production build — not `nuxt dev` — and has a DSN |

`NODE_ENV` plays no part: the live API runs with `NODE_ENV=dev`.

## Build time (source maps, User Story 6 — not implemented yet)

| Name | Kind | Effect |
|------|------|--------|
| `GLITCHTIP_AUTH_TOKEN` | GitHub Actions secret → Docker build secret | allows the upload; absent = no upload, no client source maps built |
| `GLITCHTIP_URL` | Actions variable | tracker host |
| `GLITCHTIP_ORG` | Actions variable | organisation slug |
| `GLITCHTIP_PROJECT_ADMIN`, `GLITCHTIP_PROJECT_APP` | Actions variables | project slugs |

The token is mounted for one `RUN` step in the builder stage. It is not an
`ARG`, not an `ENV`, and is not in any image layer or in the console output.

## Guarantees

- No real DSN, token, organisation or project slug is committed.
  `.env.example` files carry the variable names with empty values, and
  `scripts/sentry-twin.test.ts` fails on a real DSN anywhere in the repository.
- A DSN containing `example.com` is treated as empty.
- Local development reports nothing whatever is set.
- The repository's manifests enable reporting only where the referenced secret
  exists; the Mazda fork's gitops has no such secret and no such reference.
