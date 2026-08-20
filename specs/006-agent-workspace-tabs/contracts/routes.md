# Contract — Routes & URL state

**Feature**: [../spec.md](../spec.md) | **Date**: 2026-08-20

The user-visible contract of this feature is its URLs. These are what deep links, bookmarks,
shared links and the browser's Back button depend on, so they are specified before the
components that render them.

## Admin console

| Route | Before | After |
|-------|--------|-------|
| `/agents` | Agents table | **Resolver** — picks the landing agent and `replace`-navigates to `/agents/:id`. Renders only when there are no agents at all. |
| `/agents/:id` | Chat + 9 vertical tabs | **Workspace** — rail, chat + logs, settings panel |
| `/agents/:id?tab=<section>` | Selected that tab | Workspace with `<section>` showing in the middle canvas and the panel marking it current |
| `/agents/create` | Create form | Unchanged |
| `/agents/:id/edit` | Edit form | Unchanged — reached from the settings panel's Edit action |
| `/agents/:id/paddock` | Paddock page | Unchanged — the Paddock section links out to it |
| `/agents/all` | — | **Does not exist.** FR-008 removes the table entirely; this route is named here only to state that it is not the fallback. |

### Landing resolution (`/agents`, admin)

```
1. agents.find(a => a.isAdmin)          → the Ranch admin ("rancher") agent
2. else max by updatedAt                → most recently updated
3. else                                 → render empty state in place (no redirect)
```

Navigation uses `replace: true` so `/agents` never enters the history stack — Back from an
agent returns to wherever the operator came from, not to the resolver.

### Primary navigation

The sidebar's `Agents` entry keeps `link: 'agents'` and its `Bot` icon (FR-011). No sidebar
entry is added, removed, renamed or reordered by this feature. The `Rancher` entry continues
to point at the `/rancher` setup-status page, which is a different screen from the Ranch admin
*agent* and is not touched.

## App console

| Route | Before | After |
|-------|--------|-------|
| `/agents` | Card grid | **Resolver** — picks the landing agent and `replace`-navigates. Renders only when the user can see no agents. |
| `/agents/:id` | Chat, full-bleed | **Workspace** — rail + chat (no settings panel, FR-019) |
| `/agents/create` | Create form | Unchanged |

### Landing resolution (`/agents`, app)

```
1. localStorage['agent:lastOpened'], if that id is in the visible list
2. else agents.find(a => a.status === 'running')
3. else agents[0]
4. else                                  → render empty state in place (no redirect)
```

### Layout note

`app/slices/common/components/layout/Provider.vue` already treats `/agents/:id` as a *flush*
route — no container padding, no footer — via `/^\/agents\/[^/]+$/` with `/agents/create`
excluded. The workspace inherits that treatment unchanged. `/agents` itself redirects
immediately, so it needs no flush handling; when it renders the empty state instead, the
normal contained layout is correct.

## Query-parameter contract (`?tab=`)

`tab` is **the existing parameter, with the existing values** — that is the whole point
(FR-016). It is read on mount and written on section change.

| Value | Behaviour |
|-------|-----------|
| `overview`, `knowledge`, `files`, `secrets`, `env`, `channels`, `chats`, `paddock` | The canvas shows that section; the panel opens and marks it current |
| `chat` | **Legacy.** Was a tab, is now the canvas's default mode. Normalises to "no section": the canvas shows the conversation, the panel is in its stored state, and the parameter is stripped from the URL. |
| any unrecognised value | Same as `chat` — normalised away rather than erroring |
| absent | Canvas shows the conversation; panel renders in its stored open/closed state |

**Writes**:
- Opening a section → `router.replace({ query: { ...query, tab: value } })`
- Returning to the conversation → `router.replace` with `tab: undefined`
- Closing the panel while a section is open **also** returns to the conversation and clears
  `tab`. FR-018 requires the navigator to stay visible whenever a section is on the canvas, so
  "collapse the panel but keep the section" is not a reachable state — it would strand the
  operator inside a section with no way back except the browser. *(This corrects an earlier
  draft of this contract, which said the opposite and contradicted FR-018.)*
- `replace`, never `push` — panel fiddling must not fill the history stack. Switching *agents*
  is a `push`, because that is real navigation the user expects Back to undo (FR-004).

**Invariants**
- `?tab=<valid section>` forces the panel open regardless of the stored preference, and does
  **not** write that preference (see [preferences.md](./preferences.md)).
- **Switching agents preserves `tab`.** An operator comparing Environment across two agents
  stays in Environment when they click the next agent in the rail, rather than being dropped
  back into its conversation.

## Redirect edge cases

| Situation | Behaviour |
|-----------|-----------|
| `/agents/:id` where the id does not exist or is not visible to the user | The existing "agent not found / unavailable" state renders in the middle column. The rail stays usable so the user can navigate out. No auto-redirect — silently bouncing someone off a link they were sent hides the fact that it was dead. |
| The open agent is deleted while the workspace is open | Move to the next entry in the rail (`push`), and surface what happened. Empty rail ⇒ the empty state. |
| `/agents` with an empty list | Renders in place: create CTA for Owner/Admin, the existing "ask an admin" line otherwise. No redirect loop. |
| `/agents` while the list is still loading | Rail skeleton placeholders (FR-027); resolve and redirect once the list arrives. |
