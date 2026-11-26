# Data model: Agent launch steps

Nothing new is stored on the server except one more value of an existing
field. Everything else is derived in the browser from facts the consoles
already hold. See [research.md](./research.md) R5 to R7.

## Server

### `Agent.launchContext` (existing field, one new value)

| Value | Meaning | Written when |
|---|---|---|
| `initial` | first launch ever | `firstDeployedAt` is null (unchanged) |
| `start` | **new**: launch of an agent that held no instance | status before the launch was `stopped` or `failed` |
| `restart` | launch that replaces a live instance | any other status before the launch |
| `null` | never launched | unchanged |

No migration if the column is a string, which the mapper's cast suggests; the
first task confirms it against `schema.prisma`.

## Browser

### Pod facts (`agentStatus` store; exists in `admin`, new in `app`)

Keyed by agent id. One record per agent, replaced by each frame of the status
stream.

| Field | Type | From |
|---|---|---|
| `phase` | `Pending \| Running \| Succeeded \| Failed \| Unknown` | stream |
| `ready` | boolean | stream |
| `containerWaitingReason` | string \| null | stream |
| `superseded` | boolean | stream: the server's word that this pod belongs to a launch that has been replaced |
| `restartCount` | number | stream |
| `bridleConnected` | boolean | stream |
| `connectionState` (store-wide) | `idle \| connecting \| connected \| disconnected` | the EventSource |

The agent's own `status` on a frame is patched into the agent store. It is not
kept here.

### `LaunchFacts` (input of the derivation; never stored)

| Field | Type | From |
|---|---|---|
| `kind` | `initial \| start \| restart` | `agent.launchContext`; the button pressed, until the server has answered |
| `requestInFlight` | boolean | the start/restart call |
| `status` | agent status | agent store |
| `statusReason` | string \| null | agent store (`GET /agents/:id`) |
| `pod` | pod facts \| null | `agentStatus` store |
| `hubConnected` | boolean | `agentStatus` store / bridle store |
| `wentDown` | boolean | the hub connection was seen to drop during this launch |
| `tools` | `connecting \| limited \| null` | agent store / bridle store |
| `streamConnected` | boolean | `agentStatus.connectionState` |

### `LaunchStep` (output of the derivation)

| Field | Type | Notes |
|---|---|---|
| `id` | `accepted \| stopped \| scheduled \| container \| online \| ready` | `stopped` only when `kind` is `restart` |
| `state` | `upcoming \| current \| done \| failed` | at most one `current` or `failed` |
| `reason` | string \| null | only with `failed`; as received |

### `LaunchView` (what the overlay renders)

| Field | Type | Notes |
|---|---|---|
| `kind` | `initial \| start \| restart` | picks the heading wording |
| `steps` | `LaunchStep[]` | in order |
| `outcome` | `running \| ready \| failed` | `ready` holds for 1200 ms, then the overlay clears |
| `stale` | boolean | the stream is not connected; the list shows its last state and says so |

## Rules

1. **Monotone**: within one launch the index of the current step never
   decreases. The derivation takes the furthest stage the facts prove.
2. **One launch at a time per agent**: a new launch (the request goes in
   flight again, or `status` returns to `deploying` after `running` /
   `failed`) starts a new view from the first step.
3. **Failure pins**: when `status` becomes `failed`, the step that was current
   becomes `failed` and nothing after it changes until a new launch.
4. **Stop is not failure**: `status: stopped` during a launch ends the view
   with no failed step; the overlay shows its existing `stopped` state.
5. **Ready means usable**: `ready` is done under exactly the condition that
   makes the chat overlay `null` today.
6. **Three gates**: the pod and the hub count for a launch only once the call
   is answered, the instance that was there has left the hub, and the pod is
   not `superseded`. For every kind of launch.

## Mapping to the component

`LaunchStep` → Inspira `Step`:

| Component field | Value |
|---|---|
| `text` | the step's label for its state (`admin`: English literal; `app`: `$t` key) |
| `afterText` | not used: one short line per row |
| `async` | `state === 'current'` (the component waits on it, R2) |
| `duration` | 250 ms |
| `error` | `reason`, when `state === 'failed'` |
