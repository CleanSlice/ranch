# Implementation Plan: Chat History Inside the Agent

**Branch**: `feat/CLEAN-248-agent-history-switch` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Ticket**: [CLEAN-248](https://dreamvention.atlassian.net/browse/CLEAN-248)

**Input**: Feature specification from `/specs/036-agent-history-switch/spec.md`

## Summary

History moves from its own page into the agent panel of the app console. The agent header gets a Chat | History switch with New chat beside it; History replaces the feed with this person's conversations with this agent, a closed conversation opens in the same place read-only with its Overview, and the separate History page and its top tabs are deleted.

Technically it is three small moves and one deletion:

1. **API**: `GET /me/chats` accepts `agentId` and `search`. The gateway underneath already filters by both; the route only has to pass them on, under the guard every agent-naming route already uses.
2. **App, `chat` slice**: the store keeps conversations once, by id, with a per-agent history index; the list, the reading view and the Overview become panel components built from the existing page components.
3. **App, `agent` slice**: the panel view (chat, list, one conversation) is read from the address of the agent page; the sheet draws the switch, the workspace decides what stands under it.
4. **Removal**: the History page components, the top tabs and the landing links go; the two old addresses redirect.

## Technical Context

**Language/Version**: TypeScript 5.x. API on Node 22 (NestJS 11), app console on Nuxt 4 compatibility mode (Vue 3, `ssr: false`).

**Primary Dependencies**: NestJS, Prisma, class-validator (api); Nuxt, Pinia, Tailwind 4 with container queries, `@hey-api/openapi-ts` generated SDK, `@nuxtjs/i18n` (app).

**Storage**: PostgreSQL, table `ChatSession` (existing, no migration). Transcripts stay where they are read from today.

**Testing**: api: jest (`*.spec.ts`), run directly, never through `bun run test` while a dev API is up. app: `bun test slices` (`*.test.ts`), `npx nuxt typecheck`. Repo: `bun run locale:check`, `bun run i18n:check`, `bun run test:scripts`. Browser: Playwright at 1440 px, in the Orbit column and at 390 px.

**Target Platform**: evergreen desktop and mobile browsers; API in the cluster as one process.

**Project Type**: web application: `api/` plus the `app/` console. `admin/` is read for the twin check and not changed.

**Performance Goals**: list visible within 1 s of choosing History with 200 conversations (SC-003); search answer within 1 s of the last keystroke.

**Constraints**: no change to who can see what (FR-028); the chat stays mounted while History is shown (FR-005); nothing new in `runtimeConfig.public`; English is the copy source.

**Scale/Scope**: one route changed in the API, about ten components and one store in the app, two pages turned into redirects, three slices in one console.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|-----------|--------|
| I. The slice is the unit | Slices touched: api `chat`; app `chat`, `agent`, `common`, and one emitted event in `bridle`. History UI and its store live in `chat`. The panel view and the switch live in `agent`. `chat` components take props and emit events; they do not know the agent page's address. The one sideways import is `#agent/utils/panelView` from the two redirect pages, a pure URL builder that `agent` exports for this. |
| II. Twin consoles | Affected console: **app**. `chat`: admin has its own Chats page and an agent Chats tab over the admin list; different components, different endpoint, unchanged. `agent`: admin has no workspace sheet. `common`: only app's layout and landing carry the History links. `bridle`: `NewChat.vue` exists in app only. Each is re-checked by grep at implementation and stated in the PR. |
| III. Secrets stay behind `api/` | No credential, no new public runtime config. |
| IV. One entity, one store | Conversations live once in the chat store, by id; lists hold ids. The old `sessions` array is removed, not kept beside the new one. Counter, rows and the reading view's bar read the same record. One waiver, below. |
| V. Console is a window, chat is the hands | No admin-console capability is added. The Ranch agent's `list_chats` tool already filters by agent and text for operators. Nothing to add; stated so the reviewer need not look. |
| VI. English is the source | New keys go into `en.json` of `chat` and `agent`; `bun run i18n:sync` writes `ru`. Keys of the deleted page are removed from `en.json` and synced away. Copy chosen in script travels as a key. |
| VII. A rule stays a rule | No model call. Grouping by day, the counter cap and the step-back order are plain functions with tests. |

**Gate result**: pass, with one item in Complexity Tracking.

**Post-design re-check (after Phase 1)**: unchanged. The design added no slice, no store and no dependency beyond those listed.

## Project Structure

### Documentation (this feature)

```text
specs/036-agent-history-switch/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api.md
│   └── ui.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
api/src/slices/chat/
├── dtos/myChats.dto.ts            # + agentId, search
├── myChat.controller.ts           # pass both on; agent guard on the query
├── myChat.controller.spec.ts      # new cases
└── data/chat.gateway.ts           # search skips the user-id branch when the list is one user's
api/swagger-spec.json              # regenerated

app/slices/setup/api/data/repositories/api/*.gen.ts   # regenerated, chat hunks only
admin/slices/setup/api/...                             # regenerated if the spec diff reaches it

app/slices/chat/
├── stores/chat.ts                 # byId + per-agent history index; old list state removed
├── domain/ data/                  # listMine takes agentId, search
├── utils/historyGroups.ts (+ .test.ts)   # Today / This week / Earlier
├── components/chat/history/
│   ├── Provider.vue               # list or conversation, by props
│   ├── List.vue                   # search, groups, load more, sync, states
│   ├── Row.vue                    # replaces list/Card.vue
│   ├── Conversation.vue           # from detail/Provider.vue: bar, feed, read-only line
│   ├── Overview.vue               # the old right rail, whole
│   └── NavMap.vue                 # moved from detail/
├── components/chat/message/Bubble.vue    # unchanged
├── components/chat/list/, components/chat/detail/Provider.vue   # deleted
├── pages/chats/index.vue          # redirect to /agents
├── pages/chats/[id].vue           # resolve the agent, redirect into it
└── i18n/locales/en.json

app/slices/agent/
├── utils/panelView.ts (+ .test.ts)        # query <-> view, URL builder, step back
├── composables/useAgentPanelView.ts       # route binding, Escape
├── components/agent/workspace/Sheet.vue   # the switch, New chat in the middle group
├── components/agent/workspace/Provider.vue# chat kept mounted, history beside it
└── i18n/locales/en.json

app/slices/bridle/components/bridle/chat/NewChat.vue   # emits `confirmed`

app/slices/common/
├── components/layout/Provider.vue         # top tabs removed
├── components/landing/header|footer/Provider.vue   # History links removed
└── i18n/locales/en.json                   # nav.history removed

package.json                               # version bump for the release
```

**Structure Decision**: existing slices only. `chat` owns everything about a conversation's history; `agent` owns where in the agent panel it appears. No new slice and no new store.

## Delivery

One PR into `main`, built in this order so each step can be checked alone:

1. API filters, specs, SDK regeneration.
2. Store and the list behind the switch (Stories 1, 3, 6).
3. The reading view and Overview (Stories 2, 4).
4. New chat in the middle group (Story 7).
5. Redirects, then deletion of the page, tabs and links (Story 5). Last, because it removes the old way.

The app and the API ship in the same release. The API change is additive; the app sends the new parameters only after both are deployed from the same tag.

After the merge, the Mazda fork takes it with its next `chore/catch-up-upstream-N` merge; nothing in this feature is fork-specific.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle IV, rule 5: the reading view keeps a conversation's loaded messages, the person's ratings and the optimistic source rating in the component, as `detail/Provider.vue` does today | The component is moved into the panel, not rewritten. The messages have exactly one reader, so no second copy can disagree; the conversation record itself is in the store | Moving transcripts into a store means paging, feedback and source ratings by id for a view that one component renders. That is its own change and would double this one; it is existing debt and stays cited as such, not copied to a second place |
