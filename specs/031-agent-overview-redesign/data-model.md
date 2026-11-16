# Data model: Agent Overview redesign

Nothing is stored that was not stored before. No table, route or DTO changes.
This file describes the page's own state and where each existing fact lands.

## Section (static, `workspace/sections.ts`)

| Field | Notes |
|-------|-------|
| `value` | the `?tab=` value; unchanged, a shared-link contract |
| `title` | shown in the row |
| `desc` | no longer shown in the list; the row's tooltip |
| `group` | **new**: `null` (Overview) \| `'configure'` \| `'data'` \| `'observe'` |
| `countKey` | unchanged: knowledge, a2a, files, secrets, channels |
| `icon` | unchanged |

Order: overview · knowledge, a2a, channels, secrets, env · files, chats ·
logs, events, paddock. `SECTION_GROUPS` gives the headings: Configure, Data,
Observe.

## Draft (page state, `utils/agentDraft.ts` + `composables/useAgentDraft.ts`)

Exists only while Overview is mounted.

```text
saved:   what the stores hold now                 (agent record + limits)
touched: Partial<EditableFields>                  (only what the operator edited)
value(field)   = field in touched ? touched[field] : saved[field]
changed(field) = field in touched && !equal(touched[field], saved[field])
```

`EditableFields`:

| Field | Saved in | Equality | Needs restart |
|-------|----------|----------|---------------|
| `name` | `agent.name` | trimmed string | marks pending |
| `description` | `agent.config.description` (absent = empty) | trimmed string | marks pending |
| `llmCredentialId` | `agent.llmCredentialId` | id | marks pending |
| `knowledgeIds` | `agent.knowledgeIds` (`[]` = the template's) | same set | marks pending |
| `cpu`, `memory` | `agent.resources` | trimmed string | **offers "Save and restart"** |
| `debugEnabled` | `agent.debugEnabled` | boolean | marks pending |
| `isPublic` | `agent.isPublic` | boolean | marks pending |
| `allowedOrigins` | `agent.allowedOrigins` | same list, same order | marks pending |
| `perMinute`, `perHour`, `perDay` | limit record (`null` = not limited) | number or null | no |

Derived:

- `count` — number of changed fields.
- `needsRestartOffer` — `cpu` or `memory` changed.
- `payload()` — `IUpdateAgentData` with changed fields only. `description`
  becomes `config: { ...saved.config, description }` (key removed when
  empty). The three limits become `limits: { perMinute, perHour, perDay }` or
  `limits: null` when all are empty; present only when a limit changed.
- `touchesLimitPath` — `isPublic` or any limit changed → save through the
  limit store; otherwise through the agent store.

Transitions: `set(field, value)` · `discard()` (clear `touched`) ·
after a successful save, clear `touched` · after a refusal, keep `touched`
and record `{ code, message }` for placement by field.

Knowledge mode is derived, not stored: `template` when `knowledgeIds` is
empty, `own` otherwise. Choosing "own" with nothing ticked is shown as an
unfinished choice and is not a change until a base is ticked — the platform
cannot represent "own list, empty".

## Limit preview (pure, `utils/limitPreview.ts`)

```text
limitPreview(series: { accepted }[60], perMinute: number | null)
  → { peak, over, refused }
     peak    = highest accepted in a minute
     over    = minutes with accepted > perMinute       (0 when null)
     refused = sum of (accepted − perMinute) over them (0 when null)
chartTop(peak, limit | null) = max(peak × 1.25, min(limit, peak × 2.2) × 1.12, 4)
```

## Usage days (pure, `usage/utils/usageDays.ts`)

`usageDays(rows, today, 7)` → seven `{ date, inputTokens, outputTokens, calls,
costUsd }`, oldest first, summed across models, zero-filled for days with no
row.

## Summary (read-only)

| Cell | Source | Unavailable when |
|------|--------|------------------|
| Status | agent record + status stream (pod phase, ready, restarts), `updatedAt` | never (the record always has a status) |
| Spend, 30 days | usage totals: cost, calls, input tokens | the usage request failed |
| Pod load | pod metrics: CPU and memory used / limit | no pod (stopped, failed), no limits reported, or the request failed |
| Requests, last minute | load snapshot: minute window used / limit; peak this hour or refused this hour | the load request failed |

## Where each fact goes (FR-009 checklist)

| Today | After |
|-------|-------|
| Runtime: status, pod phase, restarts, status reason, "runtime offline" | Summary · Status (reason in the cell's detail line) |
| Runtime: Public / Private | Access · landing-page switch |
| Runtime: template | Configuration · Template row |
| Runtime: resources configured | Configuration · Resources |
| Runtime: workflow id, created, updated | Advanced · Identifiers |
| Resource usage: pod CPU, memory | Summary · Pod load; Configuration · Resources help line ("in use now") |
| Resource usage: node disk | Advanced · Identifiers (one line) |
| LLM: provider, model, fallback, label, state, Manage | Configuration · Model |
| Knowledge bases: source and names | Configuration · Knowledge |
| Usage panel (30 d table) | Usage · four figures, seven days, "All 30 days" opens the panel |
| Request load: meters, chart, refusals, exempt, peaks | Request limit |
| Visibility & embed: switch, origins, snippets, CSP note | Access (snippets and CSP note inside Embed code) |
| Visibility & embed: limits, uncovered note, share warning | Request limit; share warning in Access |
| Edit page: name, description, model, knowledge, resources | Configuration |
| Edit page: debug, promote / demote | Advanced |
| Edit page: delete with backup and wipe options | Delete agent |
