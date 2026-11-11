# Error tracking

Applies to whoever runs a Ranch installation and to whoever changes what Ranch
reports. The feature is CLEAN-218; its rules are in `specs/029-error-tracking/`.

## What this is

`api`, `admin` and `app` report unexpected failures to an error tracker that
speaks the Sentry protocol — ours is GlitchTip — each to its own project. The
three share one rule set and differ only in where they send.

It is **off until an installation turns it on**. No destination is committed
to this repository, so a checkout, a local run, and a fork that merges this
code all report nowhere.

Only the Ranch production reports. There is no dev or stage environment, and
the Mazda installation is not a source: its gitops has neither the secret nor
the reference described below.

## What is reported

| Reported | Not reported |
|----------|--------------|
| An API request that fails with a 5xx | "Not signed in" (401), in any project |
| An error thrown by a guard, a pipe or a handler that nobody caught | Any other 4xx: no permission, invalid input, not found |
| A failure in background work: a timer, a queue, a deploy | The user's own network: offline, a cancelled request |
| An unhandled rejection or exception in the API process | A stale tab asking for a chunk the last release removed |
| A console screen that throws | The Kubernetes watch timeout the API already handles |
| A console that receives a 5xx from the API | Anything at all in local development |

The decision is one table, in `sentry.rules.ts`; the contract is
`specs/029-error-tracking/contracts/reporting-rules.md`.

Every event carries `project`, `installation` and the release version. A
request failure adds `operation` (the route pattern, never the URL); a
background one adds `area`; a console one adds `screen`. A known application
error adds `statusCode` and `errorCode`.

## What never leaves

- Request and response bodies are not attached. Ranch's bodies are chat
  messages, file contents and provider keys.
- Cookies are deleted. Passwords, tokens, authorization headers, API keys,
  session ids, emails and phone numbers are replaced with `[Filtered]`
  wherever they appear, including in query strings.
- The user is an opaque id. No email, name or network address.
- Console log breadcrumbs are dropped.
- More than 20 events a minute from one process or tab are dropped, so one
  broken screen cannot flood the tracker.

## Turning it on

Each project needs a DSN from its own tracker project. They go into one
secret in the `platform` namespace; the manifests reference its keys as
optional, so a cluster without it starts normally.

```bash
kubectl -n platform create secret generic ranch-error-tracking \
  --from-literal=API_SENTRY_DSN='<dsn of the api project>' \
  --from-literal=ADMIN_SENTRY_DSN='<dsn of the admin project>' \
  --from-literal=APP_SENTRY_DSN='<dsn of the app project>'

kubectl -n platform rollout restart deploy/ranch-api deploy/ranch-admin deploy/ranch-app
```

Type the values into the command, or read them from a file outside the
repository. Do not put them in a manifest, a ticket or a pull request.

| Variable | Read by | Meaning |
|----------|---------|---------|
| `SENTRY_DSN` | api | Destination. Empty or unset = off. |
| `SENTRY_INSTALLATION` | api | Optional label; defaults to the host of `PUBLIC_API_URL`. |
| `NUXT_PUBLIC_SENTRY_DSN` | admin, app | Destination, read at runtime. Empty or unset = off. The installation label is the hostname the console is served from. |

A console's DSN reaches every browser by design — the browser is what sends.
It is an ingest address, not a credential: it cannot read anything.

**When a project counts as deployed.** The API reports only from a built
image: `RANCH_VERSION` baked in by the Dockerfile and not `dev`. `NODE_ENV` is
not used — the live API runs with `NODE_ENV=dev`. A console reports only from
a production build, never from `nuxt dev`. In both cases a DSN left in a local
`.env` does nothing.

## Turning it off

Delete the key, or the secret, and restart the deployment. Nothing else
depends on it.

## Checking that it works

After the restart, cause one deliberate failure per project and look for one
event in each tracker project, labelled with this installation:

- **api** — any request that ends in a 500.
- **admin**, **app** — in the browser console of a signed-in tab:
  `setTimeout(() => { throw new Error('error tracking check') })`.

Resolve the three test events afterwards. The steps used during development,
against a local stand-in for the tracker, are in
`specs/029-error-tracking/quickstart.md`.

## Changing what is reported

`sentry.rules.ts` exists three times, byte for byte:
`api/src/slices/setup/sentry/`, `admin/slices/setup/sentry/`,
`app/slices/setup/sentry/`. Edit the API copy, where its spec lives, and copy
it to both consoles in the same commit. `scripts/sentry-twin.test.ts`
(`bun run test:scripts`) fails when the copies differ, when the two console
slices differ, or when a real DSN appears anywhere in the repository.

To report a background failure, call `captureBackgroundError(err, 'area')`
from `#/setup/sentry` beside the `logger.error` in a catch that logs and
carries on. Request failures need nothing: the global exception filter has
them.

## Not done yet

Console stack traces point into the built bundle, not the source. Uploading
source maps is the remaining part of CLEAN-218 (`tasks.md`, T042–T046) and
needs an upload token for the tracker.
