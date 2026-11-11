# Data Model: Error Tracking

Nothing is stored. No table, no migration, no Pinia store, no OpenAPI change.
The entities below are values that exist in memory for the length of one
decision.

## ReportingConfig

What one project knows about where it reports. Built once at startup.

| Field | Type | Source | Rule |
|-------|------|--------|------|
| `dsn` | `string \| undefined` | see [configuration](./contracts/configuration.md) | trimmed; empty or containing `example.com` → `undefined` |
| `project` | `'api' \| 'admin' \| 'app'` | constant per project | required |
| `installation` | `string` | env or hostname | falls back to `unknown`, never empty |
| `release` | `string` | `RANCH_VERSION` / `ranchVersion` | as given |
| `production` | `boolean` | api: `RANCH_VERSION` set and not `dev` (a built image); consoles: `!import.meta.dev` | — |

**Derived**: `enabled = production && dsn !== undefined`. When `enabled` is
false the SDK is never loaded or initialised.

## KnownError

The shape the rules look for on an error. Structural, not a class, so the same
check works on the consoles' `ErrorEntity` and on Nest's `HttpException`.

| Field | Type | Console source | API source |
|-------|------|----------------|------------|
| `statusCode` | `number` | `ErrorEntity.statusCode` | `HttpException.getStatus()` |
| `code` | `string \| number \| undefined` | `ErrorEntity.code` | — |
| `isToast` | `boolean \| undefined` | `ErrorEntity.isToast` | — |
| `title` | `string \| undefined` | `ErrorEntity.title` | — |

An error without a numeric `statusCode` is an **unknown error**.

## Decision

The output of the rules for one error.

| Field | Type | Meaning |
|-------|------|---------|
| `report` | `boolean` | send or drop |
| `reason` | string literal | why: `unauthorized`, `expected`, `environment`, `stale-chunk`, `ignored`, `server-failure`, `unknown` |
| `tags` | `Record<string, string>` | `statusCode`, `errorCode` when known |
| `extra` | `Record<string, unknown>` | `title` when known |

`reason` exists so a test names the rule it exercises, and so a dropped event
can be explained without a debugger.

## Event labels

Set once on the scope at init: `project`, `installation`, `release`,
`environment: production`.

Set per event:

| Label | Project | Value |
|-------|---------|-------|
| `statusCode`, `errorCode` | all | from `Decision.tags` |
| `operation` | api | `METHOD /route/:pattern` — the route pattern, never the raw URL |
| `origin` | api | `request` or `background` |
| `area` | api | the name passed to `captureBackgroundError` |
| `agentId` | api | `req.params.agentId` when the route has one |
| `screen` | admin, app | the matched route pattern |
| user | all | `{ id }` only |

## RateWindow

In-memory, per process: timestamps of events sent in the last 60 seconds.
An event arriving when the window holds 20 is dropped. Not shared between
replicas or tabs, and does not need to be.
