# Contract: launch overlay

What the implementation exposes and what the checks hold on to. Types are in
[data-model.md](../data-model.md).

## 1. `MultiStepLoader` (vendored, both consoles, byte-identical)

Path: `slices/setup/theme/components/ui/multi-step-loader/MultiStepLoader.vue`

Upstream API, unchanged:

| Prop | Type | Default |
|---|---|---|
| `steps` | `Step[]` | required |
| `loading` | `boolean` | `false` |
| `defaultDuration` | `number` | `1500` |
| `preventClose` | `boolean` | `false` |

Events: `state-change(index)`, `complete()`, `close()`.

`Step`: `text`, `afterText?`, `async?`, `duration?`, `action?`.

Additions (research R2), all optional, all inert when unset:

| Addition | Type | Effect |
|---|---|---|
| prop `contained` | `boolean`, default `false` | fills its positioned parent instead of the viewport |
| `Step.error` | `string` | the current step shows as failed with this text and does not advance |
| `Step.id` | `string` | exposed on the row as `data-step` |

With no addition used, the component renders and behaves as upstream at commit
`5ea509ce`, apart from theme tokens in place of fixed colours.

## 2. `deriveLaunch(facts: LaunchFacts): LaunchView` (both consoles, byte-identical)

Path: `admin/slices/agent/agent/utils/launchSteps.ts`,
`app/slices/agent/utils/launchSteps.ts`. Pure: no Vue, no Nuxt alias, no clock.

Guarantees:

- returns the `stopped` step if and only if `facts.kind === 'restart'`;
- at most one step is `current` or `failed`; every step before it is `done`,
  every step after it `upcoming`;
- given the same facts, returns the same view;
- contains no user-visible text.

## 3. API

`AgentDto.launchContext`: `'initial' | 'start' | 'restart' | null`
(was `'initial' | 'restart' | null`). `api/swagger-spec.json` and both SDKs
are regenerated, never edited by hand.

The public status frame (`GET /agents/status/stream`): `pod` gains
`superseded: boolean`, the pod of a launch that has been replaced. The exact
keys stay pinned by `agentStatusFrame.spec.ts`.

No new route. No new agent tool: start and restart already have theirs, and
this feature adds nothing a person can do.

## 4. Test hooks in the DOM

| Hook | On | Value |
|---|---|---|
| `data-chat-overlay` | the overlay root (`admin`, existing; added in `app`) | `starting` / `failed` / `stopped` / `tools` (`app`: `starting` / `failed`) |
| `data-launch` | the loader host | `initial` / `start` / `restart` |
| `data-launch-outcome` | the loader host | `running` / `ready` / `failed` / `stopped` |
| `data-step` | each row | the step id |
| `data-step-state` | each row | `upcoming` / `current` / `done` / `failed` |
| `data-launch-stale` | the loader host | present while the stream is not connected |
| `data-launch-action` | the button under the list | `retry` |

## 5. Wording

One short line per row, changing with its state:

| Step | Current | Done |
|---|---|---|
| `accepted` | Sending request | Request accepted |
| `stopped` | Stopping previous instance | Previous instance stopped |
| `scheduled` | Scheduling | Scheduled |
| `container` | Preparing container | Container ready |
| `online` | Connecting to Ranch | Connected to Ranch |
| `ready` | Getting ready | Ready |

An upcoming row shows its "current" wording, dimmed. A slow row appends
"taking longer than usual". A failed row keeps its "current" wording and shows
the reason under it. Heading: "Setting up agent" (`initial`), "Starting agent"
(`start`), "Restarting agent" (`restart`).

`admin`: these English literals in one table next to the host component.
`app`: keys under `launch.*` in `app/slices/agent/i18n/locales/en.json`;
`ru` comes from `bun run i18n:sync`. The `restart_stage.*` keys go away with
the elapsed-time code that used them. A failure reason is never passed through
`$t`.
