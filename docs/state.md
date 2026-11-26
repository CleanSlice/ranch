# Client state: one record per entity

Applies to `admin/` and `app/`.

## The one rule that explains the rest

**An entity lives once, in its Pinia store. Everything on screen is a view of
that record.**

The defect this rule exists for: the agents screen showed one agent as
"Deploying" in the left list and "Failed" in its own header, on the same page.
Nothing was wrong with either request. The list rendered the array one
`useAsyncData` call returned, the header rendered the object another one
returned, a status stream fed a third copy, and an optimistic flip edited a
fourth. Four copies of one agent, each free to move on without the others.
Refreshing one of them more often does not fix that; having one does.

## The rules

1. **Fetches upsert.** A list fetch replaces the store's collection; any call
   that returns a single entity (`fetchById`, create, update, restart, …)
   upserts it by id before returning. No store action hands back an entity it
   did not also store.
2. **Pushes patch the same record.** A stream, socket or poll writes into the
   store's record. It never keeps a map of its own "fresher" copies for
   components to prefer — that is a second source of truth with a nicer name.
3. **Components render by id.** `computed(() => store.byId(id))`, or the
   store's collection through `storeToRefs`. Never the value a fetch returned.
4. **`useAsyncData` is for loading state, not a render source.** Keep it for
   `pending` / `error` / `refresh`; ignore its `data`.
5. **Optimistic changes go through a store action with rollback.**
   `const rollback = store.patch(id, { … })`, and `rollback()` when the call
   fails. Never `localRef.value = { ...localRef.value, … }` in a component or
   composable.
6. **One fact, one derivation.** If a label is computed from the record (a
   display status, a tone), compute it the same way everywhere or in one shared
   place. A row that overlays pod state on the status and a header that does
   not will disagree even when they read the same record.

## Worked example: the agent store

`admin/slices/agent/agent/stores/agent.ts` (the app's
`app/slices/agent/stores/agent.ts` has the same three functions):

```ts
byId(id): IAgentData | undefined          // lookup; reactive inside a computed
upsert(agent): IAgentData                 // full record in, replaces or appends
patch(id, partial): () => void            // partial change, returns a rollback
```

- `fetchAll` replaces `agents`; `fetchById`, `fetchAdmin`, `create`, `update`,
  `restart`, `stop`, `start`, `demoteAdmin` upsert.
- `restart` / `stop` / `start` flip the status with `patch` before the request
  and roll back if it throws — callers (`useAgentLifecycle`, the app's chat
  header) do not flip anything themselves. The rollback restores a field only
  if it still holds the optimistic value, so a fresher server write that
  landed in between survives.
- The status stream (`stores/agentStatus.ts`, in both consoles since
  CLEAN-247: the launch step list is read from it) patches the status each
  frame carries into this store's record and keeps only what exists nowhere
  else: pod state and hub connectivity. In `app` the patch is applied only
  when the frame is strictly newer than the row, so a frame as old as the
  row cannot undo an optimistic flip. The stream is public (an EventSource cannot
  send a token), so a frame carries status facts only, never the row
  (CLEAN-232): the agent's `id`, `status` and `updatedAt`. When
  `updatedAt` is later than the record's, or the store has never held that
  agent, the store reads the row through the authenticated route
  (`fetchById`, which upserts; `fetchAll` after a snapshot that does not
  match the collection). A push patches, a fetch upserts, and it is still one
  record. Who created an agent (`createdBy`) is likewise only in responses
  that resolve creators (`GET /agents`, `GET /agents/:id` and the routes
  that return one agent): a record that does not say keeps the creator the
  store already holds (`keepKnownCreator`), and `null` means "nobody is
  recorded". Whether the viewer is that creator (`createdByMe`, CLEAN-259)
  comes with every agent the API returns, the status snapshot included, and
  for every role; a stream frame does not say and is completed the same way.
  "My agents" is never a second list: the mark on an avatar, the "All / Mine"
  filter and its count are all read off these records
  (`utils/agentOwnership.ts` in each console), and the filter itself is view
  state of the workspace, like the search.
- The rail (`workspace/Provider.vue`), the header (`workspace/Main.vue`), the
  Overview card, the edit page and the Files tab all read `agentStore.agents`
  / `agentStore.byId(id)`.

In code:

```ts
// loading state from the request, content from the store
const { pending, refresh } = useAsyncData(`admin-agent-${props.id}`, () =>
  agentStore.fetchById(props.id),
);
const agent = computed(() => agentStore.byId(props.id));
```

A projection for a different audience is a different collection, not a second
copy: the app's `publicAgents` (landing-page cards from `GET /agents/public`)
stays separate from `agents` on purpose.

The chat conversation record in the bridle stores follows the same rule: one
conversation per key in the store, written to by the socket and rendered by
key.

In both consoles the server's transcript is the authority for what it holds.
The store loads it when the chat opens and merges it *into* that one record —
it is never a second list beside it. What the browser keeps of a conversation
(admin: an outbox of undelivered messages; app: a stored copy of the last view)
is only what the server does not have yet. A reset reaches the record the same
way from every direction — the view that asked, another tab, the other
console — through one function, so two screens cannot disagree about what
"empty" left behind (CLEAN-136).

## The first frame

A component that is mounted again for every entity (the app's chat under the
sheet is keyed by agent id) must draw from the store in its first frame. A
`useAsyncData` awaited at the top of its setup draws nothing until the request
answers: no feed, no composer, no loader, on every switch (CLEAN-260). So:

- the request is not awaited (`{ lazy: true }`), in both consoles: it
  refreshes the record behind what is already on screen;
- "not found" / "unavailable" is said only once the request has answered
  without a record, never while it is still open;
- a request that fails for a record the store holds leaves the record alone
  and is told where the screen tells such things (`refreshFailedFor` in the
  app's agent store, shown by the sheet), not by replacing the screen;
- a conversation with nothing to show yet says "loading" until the server's
  newest page has answered (`isOpening` in the app's bridle store,
  `transcriptLoads` on the admin's conversation record), and only then
  "empty". The composer is there throughout.

`specs/032-agent-user-access/e2e/switch-agent.mjs` holds the requests back
and reads every animation frame for an empty pane.

## An account change

Two people may use one browser, one after the other. Two rules keep the
second from being shown anything of the first (CLEAN-231).

7. **An account change resets every data store.** A store that holds what an
   account read exposes one `resetForAccount()`: it empties every collection
   and keyed map, closes the sockets and stops the timers it owns, and makes
   the answer of a request that was still open a no-op (a generation counter
   compared after the `await`). The `accountScope` plugin in `user/auth` of
   each console watches the signed-in id and calls them, then drops what
   `useAsyncData` kept: on sign-out, on sign-in, and when a different account
   signs in in the session-ended dialog, where it also sends the console to
   its landing. The watcher is synchronous, so the stores are empty before
   `logout()` returns to its caller and before anything is drawn for a new
   account. The same account signing in again in that dialog changes no id
   and keeps its page. In `app` the plugin names the stores (`bridle`,
   `agent`, `chat`, `share`): a new store with account data is added there.
   In `admin` every store is covered as it is created: one with a
   `resetForAccount()` through it, any other by going back to the state it
   was created with, except the few listed in `#auth/utils/accountReset`
   that are about no account. A store that owns a socket, a timer, or records
   a component holds directly (admin's conversation record) needs its own
   function: going back to the first state does not close anything. So does
   a store whose state mirrors a per-account key (admin's `agent` and
   `agentFile`, the restart marks): the state it was created with is the
   previous account's, so its function reads the key again, for the id that
   is signed in by then.
8. **What the browser keeps carries the account.** A `localStorage` key that
   holds content or names an agent has the signed-in id in it, built by the
   console's `bridle/utils/storageKeys.ts` and nowhere else:
   `bridle:conversation:<userId>:<key>`, `bridle:seq:<userId>:<key>` and
   `agent:lastOpened:<userId>` in `app`; `bridle:debug:<userId>:<agentId>`,
   `bridle:outbox:<userId>:<agentId>:<channel>` and the restart marks
   `agent:pendingRestart:<userId>`, `agent:restartInFlight:<userId>` and
   `agentFile:pendingRestart:<userId>` in `admin`; in both,
   `bridle:queue:<userId>:<key>`, the messages a conversation still has to
   send (CLEAN-245: at most three, each with the time it was written). With no
   signed-in id there is no key: nothing is read and nothing is written. A
   share-link conversation has no account and keeps its `share:…` key. View
   preferences that name no agent (`agent:view`, the theme) stay as they
   are. A new key of this kind goes through that module, and the old shape is
   added to its one-time sweep as a new step with the next number in the
   flag: browsers that already ran the earlier steps hold the earlier number
   and still get the new one, once. The queue's key carried the account from
   its first day, so the sweep has no step for it and leaves it alone; a
   share-link conversation's queue is `bridle:queue:share:…`, the visitor's own.
   Two tabs of one person read the same key: the tab that holds the Web Lock
   `bridle-queue:<storage key>` sends, the others follow the `storage` event.

## Review checklist

- Does the template read `data` from `useAsyncData` / `useFetch`? Render from
  the store instead.
- Does a store action return an entity without storing it?
- Is there a `live…` / `fresh…` / `current…` ref next to a store that already
  holds that entity?
- Does anything assign to a local copy of an entity to "update" it?
- Does a new store hold what an account read? It needs `resetForAccount()`
  (and, in `app`, a line in the `accountScope` plugin).
- Does a new `localStorage` key hold content or name an agent? It carries
  the account id, through `bridle/utils/storageKeys.ts`.
