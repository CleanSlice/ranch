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
- The status stream (`stores/agentStatus.ts`) upserts the agent row each frame
  carries into this store and keeps only what exists nowhere else: pod state
  and hub connectivity. Its frames carry the full `AgentDto` and are decoded
  by the same `AgentMapper` as REST responses, so a frame can never thin out a
  record.
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

## Review checklist

- Does the template read `data` from `useAsyncData` / `useFetch`? Render from
  the store instead.
- Does a store action return an entity without storing it?
- Is there a `live…` / `fresh…` / `current…` ref next to a store that already
  holds that entity?
- Does anything assign to a local copy of an entity to "update" it?
