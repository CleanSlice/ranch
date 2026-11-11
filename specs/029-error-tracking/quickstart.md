# Quickstart: Verifying Error Tracking

How to prove the feature works. Local development never reports, so every
check below that expects an event uses a production-mode run.

## Prerequisites

- A GlitchTip project to receive test events. Use a scratch project, not the
  three production ones, until the last section.
- Its DSN in your shell, not in a file: `export TEST_DSN=...`
- Dependencies installed: `bun install` at the repository root.

## 1. Gates

```bash
cd api && bunx jest src/slices/setup/sentry        # rules + filter
bun run test:scripts                               # twin identity
bunx turbo typecheck --filter=app --filter=admin
cd admin && bun test slices/setup && cd ../app && bun test slices/setup
cd api && bun run build && bun run lint
```

Expected: all pass. Run jest directly, not `bun run test`, while a dev API is
running.

## 2. Local development sends nothing (SC-003)

Start all three with `TEST_DSN` set as `SENTRY_DSN` and
`NUXT_PUBLIC_SENTRY_DSN`, in dev mode. Throw an error in a console screen and
call an API route that throws.

Expected: zero events; no request to the tracker host in the browser's network
panel.

## 3. API reports (SC-001, US1)

```bash
cd api && bun run build
SENTRY_DSN=$TEST_DSN SENTRY_INSTALLATION=local-check \
  RANCH_VERSION=0.0.0-check PORT=3399 bun dist/main
```

`RANCH_VERSION` is what marks a built image; without it the API behaves as
local development and reports nothing.

| Do | Expect |
|----|--------|
| call a route that throws an unexpected error | one event: `project=api`, `origin=request`, `operation` is the route pattern, `statusCode=500` |
| call a route without a token | no event |
| send invalid input to a validated route | no event |
| trigger a rejected promise outside a request | one event, `origin=background` |

## 4. A console reports (SC-001, US2)

```bash
cd admin && npx nuxt build     # `bun run build` also regenerates the SDK and needs api/swagger-spec.json
NUXT_PUBLIC_SENTRY_DSN=$TEST_DSN NUXT_PUBLIC_API_URL=http://localhost:3399 \
  node .output/server/index.mjs
```

This also proves a runtime variable reaches an `ssr: false` console (R13).
Repeat for `app`.

| Do | Expect |
|----|--------|
| throw in a component | one event: `project=admin`, `screen` is the route pattern, release set |
| make the API return 500 | one event with `statusCode=500` |
| let the session expire, then navigate | no event |
| submit a form the API rejects with 400 | no event |
| stop the API, then click something that fetches | no event |

## 5. Nothing private leaves (SC-005, US3)

In production mode, force failures in: sign-in, sending a chat message,
uploading a file, saving a provider credential. Open each event's JSON.

Expected: no request body, no cookie, no `Authorization` value, no email, no
message text, no file content; `user` is `{ id }` only.

## 6. The tracker being down changes nothing (SC-006)

Set the DSN to a host that does not answer (`https://key@10.255.255.1/1`) and
repeat sections 3 and 4.

Expected: same responses, same screens, same logs, no added wait on the
request path — capture is not awaited. The API process stays up.

## 7. No configuration, no reporting (SC-007, SC-011)

Run sections 3 and 4 with no DSN set.

Expected: starts with no warning; zero requests to any tracker. This is the
state the Mazda fork is in after a catch-up merge.

## 8. Readable traces (SC-008, US6)

Build a console image with the upload token supplied as a build secret, run
it, force an error.

Expected: the top frame of the event names a `.vue` or `.ts` file and line
that exist at that commit; `ls .output/public/_nuxt/*.map` in the image is
empty. Build once more without the token: the build succeeds and the trace is
unmapped.

## 9. After the release

Once merged and released, with the three real DSNs in the cluster secrets:
trigger one deliberate failure per project in production, confirm one event in
each of Ranch Api, Ranch Admin and Ranch App, and resolve them.
