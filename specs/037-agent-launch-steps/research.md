# Research: Agent launch steps

Phase 0 of [plan.md](./plan.md). Each entry is a decision the plan rests on,
with what was read to reach it.

## R1. The component is taken from Inspira UI, not imitated

**Decision**: Vendor `MultiStepLoader.vue` from `unovue/inspira-ui`
(`app/components/inspira/ui/multi-step-loader/`, commit `5ea509ce`, 2026-03-03,
MIT) into `slices/setup/theme/components/ui/multi-step-loader/` of both
consoles. Its props (`steps`, `loading`, `defaultDuration`, `preventClose`),
its events (`state-change`, `complete`, `close`), its step shape (`text`,
`afterText`, `async`, `duration`, `action`), its markup and its motion (the
list scrolling up under a fixed current row, opacity falling off with distance,
check / spinner / outline icons) stay as published.

**Rationale**: The requester named this component as the goal. Inspira UI is
distributed as source to copy, so vendoring is the intended way to use it, and
`app` already does exactly this for five Inspira components (`border-beam`,
`animated-beam`, `marquee`, `meteors`, `shimmer-button`) in the same directory.
The file has one import besides Vue (`cn`), which both consoles already have at
`#theme/utils`. No npm dependency is added.

**Alternatives considered**: Writing our own step list in the same style
(rejected: it is not the component that was asked for, and it would drift from
the reference). Installing a package (there is none; Inspira is not published
as a component package).

## R2. What must change in the vendored file, and nothing else

Read against the spec, the published file cannot be used byte for byte. The
changes are listed here so a reviewer can diff the vendored file against
upstream and find exactly these:

| # | Upstream behaviour | Change | Why |
|---|---|---|---|
| 1 | Root is `fixed inset-0 z-100` with a full-screen radial backdrop | New prop `contained` (default `false` keeps upstream). When set, the root is `absolute inset-0` and the list block uses a compact size that fits the chat area at 390 px | FR-012: the list lives in the existing launch overlay |
| 2 | `text-black dark:text-white`, `bg-white dark:bg-black`, `text-gray-500` | Theme tokens: `text-foreground`, `bg-background`, `text-muted-foreground` (`text-primary` is already a token) | FR-015: each console's own theme, light and dark |
| 3 | A step is upcoming, current or done; there is no failure | Optional `error?: string` on a step. A current step with `error` shows an alert icon in `text-destructive` and the text under it, and does not advance | FR-009 |
| 4 | Rows carry nothing to hold on to | Optional `id` on a step; `data-step`, `data-step-state` and `aria-current` on each row | the browser checks, and assistive technology |
| 5 | No live region, motion always on | `role="status"` + `aria-live="polite"` on the list, `motion-reduce:` variants on the transitions and the spinner | FR-018 |
| 6 | `import { cn } from "@inspira-ui/plugins"` | `import { cn } from '#theme/utils'` | the alias both consoles use |

A `footer` slot was planned and dropped: the host draws the heading above the
loader's box and the restart button under it, so the component needs no slot.
In contained mode the list is `text-sm` on a 24 px line, which makes a row
exactly the 40 px the upstream scroll step assumes; no seventh entry was
needed.

Not changed, and handled by the host instead:

- `watch(loading)` is not immediate, so a loader mounted with `loading` already
  `true` never starts. The host mounts it with `false` and raises it in
  `onMounted`.
- A step with `async: false` advances after `duration || defaultDuration`; `0`
  falls back to the default. Steps already passed are given the catch-up
  duration (R8), so a page opened mid-launch runs through them quickly instead
  of jumping.
- `loading` going `false → true` resets to the first step. A new launch of the
  same agent re-keys the loader.
- "Taking longer than expected" is a change of the step's `text`, which the
  component already renders reactively.
- `preventClose` is always `true`: the overlay is not dismissable today.

**Alternatives considered**: Wrapping the untouched file and overriding it from
outside (rejected: `fixed` cannot be undone from a parent without a transform
hack, and a failure state cannot be added from outside at all). Forking it
freely (rejected by R1).

## R3. One file, two consoles

**Decision**: The vendored `MultiStepLoader.vue` and the pure step derivation
`launchSteps.ts` are byte-identical in `admin` and `app`, enforced by a new
`scripts/launch-steps-twin.test.ts` under `bun run test:scripts`.

**Rationale**: Constitution II. The repo already keeps twins honest this way
(`chat-md-twin.test.ts`, `log-lines-twin.test.ts`, `sentry-twin.test.ts`). The
component can be identical because it styles itself with tokens both themes
define and takes its text through props. The derivation can be identical
because it returns step ids and states, not words: `admin` maps ids to English
literals, `app` maps them to `$t` keys.

## R4. Where the list goes

**Decision**: Inside the overlay each console already raises over the chat
transcript.

- `admin`: `slices/agent/agent/components/agent/chat/Tab.vue`, the
  `[data-chat-overlay]` block, for `overlay.kind === 'starting'`, and for
  `'failed'` when the failure ended a launch. `stopped` and `tools` outside a
  launch keep their markup.
- `app`: `slices/agent/components/agent/chat/Provider.vue`, the `#overlay`
  slot of `BridleChatProvider`. The card with the pulsing avatar, the
  indeterminate bar and the elapsed counter is replaced by the loader.

Both overlays are `absolute` over the message area and leave the composer free
(CLEAN-245: what is written meanwhile waits in the queue). That does not change.

## R5. What each stage is read from

The public status stream `GET /agents/status/stream` (SSE, `@Public`) carries,
per agent: `status`, the pod's `phase`, `ready`, `restartCount`,
`containerWaitingReason`, and `bridleConnected`. `admin` already reads it into
`stores/agentStatus.ts`. `app` does not read it at all.

| Step id | Current while | Done when |
|---|---|---|
| `accepted` | the start/restart call is in flight | the call returned, or `status` is `pending` / `deploying` |
| `stopped` (restart only) | the old runtime is still on the hub, or the old pod is still reported | the hub connection dropped, or no pod / a new pod is reported |
| `scheduled` | no pod yet, or `phase: Pending` with no waiting reason | a waiting reason appears (`ContainerCreating`, `PodInitializing`) or `phase: Running` |
| `container` | `phase: Pending` with `ContainerCreating` / `PodInitializing` | `phase: Running` |
| `online` | `phase: Running`, hub not connected | `bridleConnected` for the new instance |
| `ready` | on the hub, tools still `connecting` | `status: running` and tools not `connecting`: the same condition under which the chat overlay is `null` today |

**Decision**: The derivation is monotone. It computes the furthest stage the
facts prove and marks everything before it done. A stage that was never seen
(a container that was already there, a local run with no pod at all) is done
the moment a later one is proven. It never moves back within one launch.

**Decision** (requester, 2026-11-26): "the runtime started" and "it connected
to Ranch" are one row, `online`. One fact ends both, so two rows would tick at
the same instant. The list is six rows for a restart and five for a start.

**Decision** (requester, 2026-11-26): wording is short. Each row is one line of
two or three words that changes with its state; `afterText` is not used. The
table is in [contracts/launch-ui.md](./contracts/launch-ui.md) §5.

**Decision**: While tools are still connecting at the end of a launch, that is
the `ready` step's own wait, with the tool line as its text. The separate
`tools` overlay stays for the case it was built for: an agent already up whose
tools reconnect on their own.

**Failure**: `status: failed` puts `error` on the step that was current.
The text is `statusReason` from `GET /agents/:id`, else the pod's
`containerWaitingReason`, shown as received.

**Found in the first task**: the public frame carries neither `terminating`
nor when the pod started (CLEAN-232 took both off). That matters more than the
plan assumed. On a restart the old pod stays `Running` for as long as it takes
to terminate, after its runtime has already left the hub; a list reading the
frame as it was would tick "scheduled" and "container ready" off the pod being
replaced, and sit on "connecting" for the whole real launch.

**Decision**: the frame's pod gains one word, `superseded`: the pod is being
deleted, or it started before the agent's current launch began
(`lastDeployStartedAt`, rounded down to the second as Kubernetes rounds a
pod's start). The server already makes this judgment in memory
(`DeployTracker.isStale`); `podSuperseded` makes it off the row, so it holds
after an API restart. Still no pod name, no start time, no reason text.

**Decision**: three gates before the pod or the hub counts for a launch, in
`deriveLaunch`: the call has been answered, the instance that was there has
left the hub (`wentDown`), and the pod is not `superseded`. Each alone has a
moment when it is late. The gates apply to every kind of launch, not only a
restart: someone who may not manage the agent is given no `launchContext`
(`agentReaderView`), so their list has the shape of a start, and it must not
be ticked by the old instance either.

**Readers**: for an account that may not manage the agent the API hides
`launchContext` and `statusReason`. Their list has no "previous instance
stopped" row, the wait for the old instance shows as "scheduling", and a
failure shows the reason the stream gives everybody (the pod's waiting
reason). That boundary is CLEAN-232's and is left where it is.

**`app` and "ready"**: in `app` the overlay has always cleared when the agent
reads `running`, and the tool servers have their own line in the chat. So
there `running` proves the last steps; in `admin` they wait for the hub and
the tools, as its overlay does.

## R6. `app` needs the status stream

**Decision**: Add `stores/agentStatus.ts` with its gateway to `app/slices/agent`,
holding only what exists nowhere else: pod facts and hub connectivity per
agent, plus the connection state. The agent's `status` on a frame is patched
into the agent store, and only when the frame is strictly newer than the row
(`frameIsNewer`): a frame as old as the row would undo the optimistic
`deploying` the row wears while a restart call is out. There is a gateway and
no service above it, because there is no rule to hold.

**Rationale**: Without it `app` has `status` on a 3-second poll and nothing
between `deploying` and `running`, which is why it shows text chosen by
elapsed seconds today. FR-005 forbids that and FR-015 asks for the same steps
in both consoles. Constitution IV is met: pod state is its own entity and is
held once.

**Alternatives considered**: A shorter list in `app` from `status` and the hub
alone (rejected: two different lists for one launch). Porting `admin`'s store
whole (rejected: most of it handles which rows an account may read, which
`app` already solves through its own list read; only the pod facts are
needed).

## R7. Telling a start from a restart

**Decision**: The API's `launchContext` gains a third value. Today
`agentDeploy.service.ts` writes `'initial'` when the agent has never been
deployed and `'restart'` otherwise, so starting a stopped agent reads as a
restart. It will write `'start'` when the agent held no instance at the moment
of the launch (`stopped` or `failed`), and `'restart'` when it did.

**Rationale**: The `stopped` step must be absent for a start (spec, story 2)
and the list must not change shape between the person who pressed the button
and someone who opened the page a second later. Only the server knows what the
agent was before the launch. `admin` compares against `'initial'` and
`'restart'` only, and its "restarted / started" label already reads correctly
with a third value.

**Cost**: one enum value, regenerated SDK in both consoles. This makes the
ticket `[ADMIN][APP][API]`.

**Alternatives considered**: Remembering the kind in the browser (rejected:
wrong for anyone who did not press the button). Always showing the `stopped`
row and ticking it at once for a start (rejected: the spec says the row is not
there).

## R8. Numbers and where they come from

| Number | Value | Reason |
|---|---|---|
| Catch-up duration per passed step | 250 ms | Six rows at 250 ms is 1.5 s, inside the 2 s of SC-003, and still long enough to see each row tick |
| Hold on the completed list | 1200 ms | Long enough to read one line ("Agent is ready"), short enough not to delay the first message; the queue sends on its own anyway |
| "Taking longer" budget per step | measured | Set in a task from at least 10 restarts and 10 starts on dev: twice the p95 of each step. No value is invented before that measurement; until it lands, no step is marked slow |

## R9. How it is checked

**Decision**: Three layers.

1. `bun test` on `launchSteps.ts` in both consoles: every row of the R5 table,
   skipped stages, failure on each step, start vs restart vs initial, a second
   launch.
2. `scripts/launch-steps-twin.test.ts`: the twins are identical.
3. Playwright (`playwright-core`, as in specs 026 to 031) against the local
   stack at 390 px and 1440 px, both themes, both consoles. The local stack
   has no pods, so a real local restart only ever shows the jump from
   `accepted` to `online`. To see every row, the script replaces
   `EventSource` with a scripted one before the page loads and feeds the
   frames of R5 in order; one further run does a real restart with nothing
   mocked.

**As run**: `e2e/launch.mjs` (76 checks) and `e2e/look.mjs` (93 checks). The
hub is not mocked: the test connects and disconnects a real runtime for the
fixture agent. Restart, start and stop are answered in the page by the
server's own rules, so no workflow is submitted. The admin console ships one
theme (light) and the app console one (dark); each is photographed as it
ships, and the admin's `.dark` tokens by putting the class on.

**Limit, stated plainly**: The pod-by-pod stages are only ever real on a
cluster. Locally they are proven against scripted frames. The real thing is
checked on dev after the merge, as CLAUDE.md requires for anything that
depends on the rollout.
