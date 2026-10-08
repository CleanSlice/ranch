# Contract: Admin Console — Events, Agent Section, Notification Settings

**Covers**: FR-023 – FR-029, FR-031, FR-032; User Stories 5 and 6.

Admin console only, English only. The customer console is unchanged.

## Slice

`admin/slices/agent/event/` — alias `#agentEvent`, registered by
`registerSlices.ts` because it has a `nuxt.config.ts`.

```text
admin/slices/agent/event/
├── nuxt.config.ts
├── plugins/{di.ts,menu.ts}
├── domain/{agentEvent.types.ts,agentEvent.gateway.ts,agentEvent.service.ts,index.ts}
├── data/{agentEvent.gateway.ts,agentEvent.mapper.ts,index.ts}
├── stores/agentEvent.ts
├── utils/{eventTone.ts,eventTone.test.ts}
├── components/agentEvent/
│   ├── Provider.vue            # the /events page body
│   ├── Table.vue               # shared by the page and the agent section
│   ├── OutcomeBadge.vue
│   ├── DeliveryBadge.vue
│   └── destination/{Form.vue,TestButton.vue,SenderGuide.vue}
└── pages/
    ├── events.vue
    └── settings/notifications.vue
```

The gateway uses the generated SDK (`#api/data`) and `unwrapOrThrow`, as
`agent.gateway.ts` does. The store follows
[data-model.md](../data-model.md#console-store-shape-adminslicesagenteventstoresagenteventts).

## `/events`

Sidebar: group *Main*, title "Events", via `plugins/menu.ts`. The page title
comes from the sidebar item.

**Redesigned 2026-10-06 after the first look at it with real data**: two flat
tables one above the other let the raw reports — five identical "again"s, a
burst of "unknown agent" — bury the thing the page is opened for. The page is
now two views behind tabs, held in `?view=` (the default carries no
parameter):

- **Incidents** (default; the tab shows the open count) — one row per
  incident: a state badge (*Failed* / *Unreachable* while open, *Recovering*
  once Ranch has seen the agent come up, how it ended once closed), the agent,
  the number of reports, the first cause on one line, since when and for how
  long, who reported, whether the opening and the closing message were
  delivered. `ListSearch` by agent and `ListSegments` *Open n* / *Closed* /
  *All*. A row opens into its reports — the same table as below, without the
  agent and notification columns (`GET /agent-events?incidentId=`).
  `components/agentEvent/IncidentList.vue`.
- **Event log** — every report as it arrived, newest first, including those
  attached to no incident. `ListSearch` and `ListSegments` *All* / *Failures*
  / *No incident* / *Not notified*; the default `Table*` components, no
  wrapper. Columns: time, agent (link to the agent's events section), status,
  cause, reported by, outcome, notification.
- **Time**: `occurredAt` through `#common/utils/format` (`formatStamp`); when
  `receivedAt` differs from it by more than a minute, a second line "received
  …" (FR-006). Never `toLocale*String` or `Intl.*` in a component.
- **Cause**: as received, in a monospace cell, wrapped; never translated,
  trimmed of nothing but length on screen (full text on hover) (FR-032).
- **Reported by**: `senderName`, with `tool` after it when present; Ranch's
  own events read "Ranch".
- **Outcome**: one badge from `eventTone.ts` — the single place that maps
  `outcome` to a label and a tone:

  | `outcome` | Label |
  |-----------|-------|
  | `opened` | Opened an incident |
  | `joined` | Same incident |
  | `suppressed_stopped` | Agent was stopped on purpose |
  | `suppressed_starting` | Agent was being started |
  | `unmatched` | Unknown agent — shows `agentRef` |
  | `evidence` | Recovery reported |

- **Notification**: from the incident's `notifications[]` — *Notified*,
  *Retrying (n)*, *Not delivered* with the error on hover, *No destination*.
- **No destination set**: a banner above the list — "Nobody outside this
  console is being notified" with a link to *Settings → Notifications*
  (FR-023).
- **Refresh**: `store.watch()` on mount, `unwatch()` on unmount; a new event
  appears within 5 seconds without a reload (FR-025).
- **Load more**: `store.fetchMore()` with the cursor.
- **Loading / error**: `useAsyncData` for `pending` and `error` only.

## Agent page — section "Events"

- `admin/slices/agent/agent/components/agent/workspace/sections.ts`: a new
  entry in `SECTIONS` — `value: 'events'`, after `logs`.
- `components/agent/workspace/Canvas.vue`: one more branch rendering
  `<AgentEventTable :agent-id>`.
- No count on the section (`countKey: null`). A count of open incidents was
  planned and left out: it would be 0 or 1, the agent's own status badge
  already says "failed", and it would cost every agent page one more request.
- `utils/sections.test.ts`: updated.

Shows that agent's events only (FR-024). The link in a notification lands
here: `/agents/<id>?tab=events`.

## `/settings/notifications`

The page file lives in the event slice; `setting`'s
`components/setting/nav/Menu.vue` gets one entry — "Notifications — where the
team is told when an agent goes down".

Not a `SettingForm`: the address is not a setting row (research D10).

- **Destination** (`destination/Form.vue`)
  - Not set: a password field "Slack webhook address", a *Save* button, three
    lines on how to get one, linking to Slack's guide.
  - Set: "Slack · ends in «hint» · set by «user» «when»", *Replace*, *Remove*
    (confirm dialog). The address is never shown again — the field starts
    empty on *Replace* (FR-029).
  - A non-Slack address shows the server's reason inline.
  - `consoleLinks: false`: a warning — "Messages will carry no link to the
    console until `ADMIN_URL` is set on the API".
- **Test** (`destination/TestButton.vue`, modelled on
  `setting/github/StatusCheck.vue`): *Send a test* → "Delivered" or the
  error, inline. Shows the last delivery's time and outcome.
- **Senders** (`destination/SenderGuide.vue`): the address to post to
  (`runtime.public.apiUrl` + `/agent-events`), the minimal body, a `curl`
  example, and a link to *API keys* to create a key with the `events:write`
  scope (FR-031). Owners only for save, remove and test; admins see the page
  read-only.

## API keys dialog

`admin/slices/user/apiKey/`:

- `domain/apiKey.types.ts` — `ApiKeyScopeTypes.EventsWrite = 'events:write'`;
- `components/apiKey/CreateDialog.vue` — `SCOPE_OPTIONS` entry: "Post agent
  events — report an agent failure to Ranch. Nothing else.";
- `data/apiKey.mapper.ts` — the allow-list, which otherwise drops the scope.

## Format module

`admin/slices/common/utils/format.ts`: `formatSpan(from: Instant, to: Instant): string`
— "45 s", "16 min", "2 h 5 min", "3 d 4 h". Pure, tested beside the module.

## Twin consoles

| Admin slice touched | Twin in `app/` | Needs a change |
|---------------------|----------------|----------------|
| `agent` (sections, Canvas) | `app/slices/agent` has no section list | no |
| `user` (API-key scope) | `app/slices/user` has no API-key screen | no |
| `common` (`formatSpan`) | `app` formats through `useFormat()`; nothing there shows a time span | no |
| `agent/event` (new), `setting` | not twins | — |

## Tests (admin)

`bun test slices`: `eventTone.test.ts` (every `outcome` has a label; an
unknown one falls back, not blank), `sections.test.ts`, `formatSpan` cases,
the store's merge (a refresh upserts and never duplicates; `fetchMore`
appends in order). `npx nuxt typecheck`. `bun run locale:check`.
