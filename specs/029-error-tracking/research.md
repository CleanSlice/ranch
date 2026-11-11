# Research: Error Tracking for API, Admin and App

Findings from reading this repository and main-site's `setup/sentry` slice.
Each entry is a decision the plan depends on.

## R1. How one rule set is shared by three projects

**Decision**: One pure file, `sentry.rules.ts`, present in three places and
byte-identical: `api/src/slices/setup/sentry/`, `admin/slices/setup/sentry/`,
`app/slices/setup/sentry/`. A test in `scripts/` fails CI when the copies
differ. The two console slices are identical as whole directories.

**Rationale**: The repository shares console behaviour by copying under a
guard, and already has the guard pattern: `scripts/chat-md-twin.test.ts`, run by
`bun run test:scripts` in `ci.yaml`. The rules file imports nothing at all —
it declares the few event fields it touches itself, rather than importing SDK
types from a package none of the three projects depends on directly — so the
same text compiles under NestJS and under Nuxt. Nothing changes in the
three Dockerfiles, in `turbo.json`, or in the Mazda fork's build.

**Alternatives considered**:

- *A fourth workspace package imported by all three.* Truly one copy, but the
  API compiles to CommonJS through `nest build` + `tsc-alias`, jest needs a
  `moduleNameMapper` entry, each Dockerfile copies workspace manifests by name,
  and the fork's CodeBuild has to follow. Four build systems change so that
  roughly 200 lines exist once. Rejected for this feature; if a second shared
  module appears, the package becomes worth its cost and the twin test is the
  thing to delete.
- *Rules in the API, consoles ask the API.* A console error that cannot reach
  the API is exactly the one that would be lost. Rejected.

## R2. Which SDK in the consoles

**Decision**: `@sentry/vue`, initialised from a client plugin of the new slice.
Not `@sentry/nuxt`.

**Rationale**: Both consoles are `ssr: false`. main-site uses `@sentry/nuxt`
because it renders on the server; here its server half has nothing to
instrument, and it brings a reserved `#sentry` alias and a build-time upload
plugin this plan does not use. GlitchTip's own instructions for these two
projects name `@sentry/vue`.

**Alternatives considered**: `@sentry/nuxt` for symmetry with main-site —
rejected, the symmetry is in the rules, not the package. `@sentry/browser` —
works, but loses the Vue component name on an event for no saving.

## R3. Which SDK in the API

**Decision**: `@sentry/bun`, loaded lazily and only when reporting is on.

**Rationale**: The production image is `oven/bun:1.4.4-slim` and `main.ts`
already works around Bun's exit-on-unhandled behaviour, so the runtime is Bun,
not Node. `@sentry/bun` is the SDK for it and wraps `@sentry/node`. Tests run
under jest on Node; loading the SDK with `require()` inside `init()`, behind
the production-and-DSN gate, means jest and local dev never load it.

**Alternatives considered**: `@sentry/nestjs` — its value is automatic
instrumentation through OpenTelemetry import hooks, which is the part least
proven under Bun, and this feature wants errors only. Rejected in favour of
explicit capture at three known points (R6).

## R4. SDK version

**Decision**: The 10.x line, `^10.56.0`, the range main-site runs.

**Rationale**: npm's latest is 11.12.0. Version 10.56 is the one already proven
against this GlitchTip instance by main-site; 11 is not. `@sentry/bun@10.56.0`
depends on `@sentry/core` and `@sentry/node` at the same version, so the three
projects resolve one core.

**Alternatives considered**: 11.x — no known benefit for error-only use, and an
unverified protocol change against GlitchTip. Revisit when main-site moves.

## R5. One choke point for the rules

**Decision**: The decision to report, the labels and the scrubbing all run in
`beforeSend`. Manual capture calls pass the raw error and nothing else.

**Rationale**: main-site gates manual captures in `captureSentryException` and
scrubs in `beforeSend`, and has to skip `init` in dev because automatic capture
bypasses the first gate. Putting the gate in `beforeSend`, which receives the
original exception in its hint, means automatic and manual captures take the
same path, which is what FR-012 and FR-022 ask for. Dev still skips `init`
entirely, as main-site does.

**Alternatives considered**: main-site's split as is — works there, but leaves
an expired-session error that surfaces as an unhandled promise rejection
unfiltered.

## R6. Where the API captures

**Decision**: Three points.

1. A global exception filter extending Nest's `BaseExceptionFilter`: captures,
   then delegates, so the response is unchanged. `ErrorHandlingInterceptor`
   keeps wrapping unknown errors as 500 but passes the original as `cause`, so
   the filter reports the real stack.
2. The existing `unhandledRejection` and `uncaughtException` handlers in
   `main.ts`: one capture call added beside the existing `console.error`.
3. An exported `captureBackgroundError(err, area)` for catch blocks that end a
   unit of work nobody is waiting on.

**Rationale**: An interceptor alone misses errors thrown by guards and pipes.
The filter sees everything on the HTTP path. The SDK's own
`OnUncaughtException` and `OnUnhandledRejection` integrations are removed: the
first exits the process, and `main.ts` deliberately keeps it alive.

**Which catch blocks get point 3** — a rule, not a judgment: a `catch` that
logs at error level and carries on, so the error reaches neither a caller nor
the exception filter. (The first wording, "not reached from an HTTP handler",
turned out too narrow on reading the code: `agentDeploy.deploy` is awaited by
a controller, swallows the failure and shows the user a deliberately generic
reason — nobody was told the real one.)

Of the 43 `logger.error` / `console.error` sites in `api/src`:

- **Wired (12 sites, 10 files)**: `chat.insight`, `chat.sync`,
  `reins.index-reconcile` (the scheduled run), `reins.extraction` ×2,
  `reins.migration` ×2, `reins.provision`, `reins.indexing`, `agent.deploy`,
  `reins.archive-import`, `paddock.evaluation`,
  `integration.extension-archive`.
- **Left, the error is rethrown** and the filter or an outer catch has it:
  `s3.repository`, `argo-workflow.gateway`, `argoInstance.gateway`,
  `source.gateway` ×2, `agentEvent.ingest.controller` (which now passes the
  original as `cause`).
- **Left, the caller receives it** as a protocol answer: the MCP handlers and
  transports.
- **Left, the user's environment**: `sse-ping.service`, a write to a
  connection the client closed.
- **Left, a retry on a 60-second tick**: the two per-knowledge catches inside
  `indexReconcile`. With LightRAG down they would send one event per knowledge
  base per minute for as long as it is down; the outage already has its own
  log line in `source.gateway`. Revisit if that outage goes unnoticed.
- **Left, not the product**: `main.ts` (wired separately, point 2),
  `generate-swagger.ts`, `scripts/purgeRussianChats.ts`.

## R7. A known error that would flood the feed

**Decision**: The Kubernetes watch timeout is not reported. The rules carry an
ignore entry matching `DOMException` named `TimeoutError`, API only.

**Rationale**: `main.ts` documents that the `@kubernetes/client-node` watch
leaks this rejection after every ~5-minute server-side timeout. Reported, it is
about 288 events a day of something already understood and handled.

## R8. What must be stripped beyond main-site's list

**Decision**: On top of main-site's key filter:

- `request.data` and `request.cookies` are deleted, never filtered by key.
- Breadcrumbs of category `console` are dropped; URL breadcrumbs keep the URL
  with sensitive parameters filtered.
- The key list gains `api_key`, `apikey`, `x-api-key`, `set-cookie`, `session`,
  `ranch_session`, `jwt`, `dsn`.

**Rationale**: Ranch's request bodies are chat messages, file contents and
provider keys. A key filter cannot recognise a chat message; not attaching
bodies can. Console breadcrumbs carry whatever the code logged, which in the
API includes agent traffic.

## R9. Errors that are the user's environment, not the product

**Decision**: `ErrorMapper` in both consoles keeps the client's own code,
`ERR_NETWORK` or `ERR_CANCELED`, when the failed request has no response. The
rules drop those two codes and failed dynamic imports (a stale tab after a
release) — in the consoles only: an outbound network failure inside the API is
a dependency being down, which is a real failure.

Only those two codes, not "any error without a response": the mapper also
receives bugs thrown inside a gateway, and those must still be reported.

**Rationale**: Today a request with no response maps to `statusCode: 500`
(`?? 500` in the mapper). Under main-site's rule that is a server failure and
would be reported every time someone's Wi-Fi drops. `ErrorCodes.ERR_NETWORK`
already exists in both consoles and is unused.

## R10. Configuration, and where the real values live

**Decision**:

| Project | Destination | Installation label | Release | "Deployed" gate |
|---------|-------------|--------------------|---------|-----------------|
| api | `SENTRY_DSN`, from key `API_SENTRY_DSN` of the cluster secret `ranch-error-tracking` | `SENTRY_INSTALLATION`, else host of `PUBLIC_API_URL`, else `unknown` | `RANCH_VERSION` | `RANCH_VERSION` set and not `dev` |
| admin, app | `NUXT_PUBLIC_SENTRY_DSN`, from keys `ADMIN_SENTRY_DSN` / `APP_SENTRY_DSN` of the same secret | `window.location.hostname` | `runtimeConfig.public.ranchVersion` | `!import.meta.dev` |

**Rationale**: All five manifests are in the repository, so they reference a
secret key with `optional: true` rather than carry a value: a cluster without
the secret starts normally and reports nothing, which is the Mazda case. One
secret with three keys is one command for the operator. The hostname is a free
installation label; the release reuses what exists.

**The API's gate is not `NODE_ENV`** (changed during implementation): the live
manifest, `k8s/deploy/30-api.yaml`, runs the production API with
`NODE_ENV: "dev"`, and `app.module.ts` picks its env file from that value, so
flipping it is not a side effect to take on here. What separates a deployed
API from a developer's is the image: the Dockerfile bakes `RANCH_VERSION` in
(`dev` when built without one) and `bun run start:dev` has none. That is the
same question the consoles answer with `import.meta.dev`.

**Alternatives considered**: DSN as a Docker build argument — bakes one
installation's address into an image the fork could reuse. Rejected.

## R11. Bounding volume

**Decision**: The rules drop events past 20 per rolling minute per process.

**Rationale**: Grouping makes a storm one issue but does not stop the sending.
A real incident produces a handful of distinct errors a minute; a failing
render loop or a per-request bug produces thousands. Twenty is far above the
first and far below the second. GlitchTip throttles on its side too; this keeps
a broken screen from spending the user's network on it.

## R12. Readable console traces

**Decision**: Upload source maps from the Docker builder stage with a pinned
`@sentry/cli` pointed at the GlitchTip host, then delete the `.map` files from
the output. The token arrives as a Docker build secret. Without it the build
turns client source maps off and skips the step.

**Rationale**: The npm package named `glitchtip-cli` is a third-party project
unrelated to GlitchTip, so it is not used. GlitchTip accepts `sentry-cli`
uploads. A build secret never lands in an image layer, and deleting the maps
keeps the source from being served.

**To verify first, at implementation**: that this GlitchTip version resolves
traces from a debug-id upload made by the pinned CLI. If not, the fallback is
GlitchTip's official CLI binary, pinned by checksum, same two commands. This is
the first task of User Story 6 and blocks nothing in Stories 1–5.

## R13. Does a runtime variable reach an `ssr: false` console

**Decision**: Yes; `NUXT_PUBLIC_SENTRY_DSN` is set on the deployment, like
`NUXT_PUBLIC_API_URL` already is in `k8s/deploy/40-admin.yaml` and
`k8s/platform/app/deployment.yaml`.

**Rationale**: `admin/nuxt.config.ts` documents that production sets
`NUXT_PUBLIC_API_URL` at runtime and Nuxt picks it up.

**Verified during implementation**: a production build of `admin`, started
with `NUXT_PUBLIC_SENTRY_DSN` pointing at a local stand-in for the tracker,
sent its events there from a real browser. The build itself had no DSN.

## R14. What was verified without the real tracker

The team's GlitchTip was not used during implementation: its DSNs stay out of
the repository and out of this work. A local HTTP server stood in for it and
recorded what each SDK sent.

- **API under Bun**, with `NODE_ENV=dev` as on the live deployment: of six
  captures, three arrived (a request failure, a background failure, a bare
  string rejection) and three were dropped by the rules (a 404, a 401, the
  Kubernetes watch timeout). No session envelope, no process listener added by
  the SDK, six calls in 5 ms.
- **`admin` in a browser**, production build: three arrived (a component
  error through the console's own Vue handler, a 503 with `statusCode` and
  `errorCode`, an uncaught error in a timer) and four were dropped (a 400, an
  `ERR_NETWORK`, a rejected 401, a stale chunk). The failed calls to an API
  that was not running produced nothing. `?token=` in the page address arrived
  as `[Filtered]`; `screen` was the route pattern.

Not verified: delivery to the real GlitchTip, which is the rollout step.
