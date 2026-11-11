# Contract: Reporting Rules

The public surface of `sentry.rules.ts` and the behaviour each function
guarantees. The file is byte-identical in `api`, `admin` and `app`, imports
nothing, and touches no global: no `process`, no `window`, no SDK call. It
declares the few event fields it reads (`SentryEventLike`) itself.

## Surface

| Function | Returns | Purpose |
|----------|---------|---------|
| `resolveDsn(raw)` | `string \| undefined` | normalise a destination |
| `isReportingEnabled(config)` | `boolean` | deployed and has a destination |
| `decide(err, project)` | `Decision` | report or drop, with labels |
| `scrubEvent(event)` | the event | remove private data |
| `scrubUrl(url)` | `string` | filter sensitive query parameters |
| `scrubText(text)` | `string` | mask credentials and emails inside free text |
| `scrubBreadcrumb(crumb)` | the crumb or `null` | drop or clean one breadcrumb |
| `createBeforeSend(project, now?)` | `(event, hint) => event \| null` | the single gate: decide, label, rate-limit, scrub |
| `buildInitOptions(config)` | SDK options | everything `init` needs except the SDK itself |

## `decide` — evaluated in this order, first match wins

| # | Applies to | Condition | `report` | `reason` |
|---|------------|-----------|----------|----------|
| 1 | api | a `DOMException` named `TimeoutError` (the Kubernetes watch) | no | `ignored` |
| 2 | admin, app | message is a failed dynamic import | no | `stale-chunk` |
| 3 | admin, app | `code` is `ERR_NETWORK` or `ERR_CANCELED` | no | `environment` |
| 4 | all | known error, status 401 | no | `unauthorized` |
| 5 | all | known error, status below 500 | no | `expected` |
| 6 | all | known error, status 500 or above | yes | `server-failure` |
| 7 | all | anything else | yes | `unknown` |

A **known error** is one that carries an HTTP status: `statusCode` (the
consoles' `ErrorEntity`), `getStatus()` (Nest's `HttpException`), or
`response.status` (a raw client error that escaped the mapper).

Rule 3 comes before the status rules on purpose: the console mapper gives a
request with no response status 500 for lack of anything else. Rules 2 and 3
do not apply to the API, where an outbound network failure is a dependency
being down.

Rules 4–6 are main-site's `shouldReportToSentry`; main-site's separate
"toast below 500" clause is covered by rule 5. Rules 1–3 are Ranch's.

For rule 6 the decision carries tags `statusCode` and, when present,
`errorCode`, and `extra.title`.

## `scrubEvent`

- Deletes `request.data` and `request.cookies`.
- Replaces with `[Filtered]` the value of any key matching, case-insensitively:
  `password`, `passwd`, `token`, `secret`, `authorization`, `cookie`,
  `set-cookie`, `email`, `phone`, `auth_token`, `access_token`,
  `refresh_token`, `api_key`, `apikey`, `x-api-key`, `session`,
  `ranch_session`, `jwt`, `dsn` — in `request.headers`, `extra`, `contexts`,
  recursively through nested objects.
- Filters the same keys in the query string of `request.url`, keeping the rest
  of the address.
- Reduces `user` to `{ id }`, and removes a user that has no id.
- Runs the event `message` and every `exception.values[].value` through
  `scrubText`. An error's own message is free text and can quote what the
  failing code held. `scrubText` masks: the user-info part of any URL
  (`postgresql://user:pass@host` → `postgresql://[Filtered]@host`), sensitive
  query parameters of any URL, `Bearer …` / `Basic …` credentials,
  `password=…` / `token: …` / `"apiKey":"…"` style assignments, provider keys
  of the `sk-…` shape, and email addresses. The user-info is everything up to
  the last `@`, since a password may hold `/`, `#`, `?` or `@`. The SDK cuts a
  long message and appends `...` before the rules see it, so a cut-off tail
  that looks like an address or an assignment is masked whole. Added after
  the security review of the first pushes; it cannot recognise a secret that has no such shape,
  which is one more reason bodies are never attached.
- Cuts nesting deeper than eight levels to `[Filtered]` rather than walk it.
- Inside `createBeforeSend`, any failure drops the event: it is never sent
  unscrubbed.

## `scrubBreadcrumb`

- Category `console` → `null`.
- A breadcrumb carrying a URL → same query filtering as above.
- A breadcrumb `message` → `scrubText`.

## `createBeforeSend`

1. `decide` on `hint.originalException`; drop when `report` is false.
2. Merge the decision's tags and extra into the event.
3. Drop when 20 events have already passed in the last 60 seconds.
4. `scrubEvent`.

A throw anywhere inside returns `null`.

## `buildInitOptions`

Always sets: `sendDefaultPii: false`, no `tracesSampleRate`, the gate from
`createBeforeSend`, `beforeBreadcrumb: scrubBreadcrumb`, `environment:
'production'`, `release`, and initial tags `project` and `installation`.

## Tests that pin this contract

- One spec for the rules, table-driven over the seven `decide` rows and the
  scrub list. It runs in the API's jest; the twin test makes it hold for the
  consoles.
- `scripts/sentry-twin.test.ts`: the three `sentry.rules.ts` files are
  byte-identical, and `admin/slices/setup/sentry` equals
  `app/slices/setup/sentry` file for file.
