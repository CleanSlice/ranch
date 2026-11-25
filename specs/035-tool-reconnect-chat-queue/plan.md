# Implementation Plan: Tools That Reconnect, a Start That Explains Itself, and a Chat Queue

**Branch**: `feat/CLEAN-245-tool-reconnect-chat-queue` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/035-tool-reconnect-chat-queue/spec.md`

**Ticket**: [CLEAN-245](https://dreamvention.atlassian.net/browse/CLEAN-245) · sub-task [CLEAN-246](https://dreamvention.atlassian.net/browse/CLEAN-246) (Bridle SDK widget, not planned here)

## Summary

Three changes that meet in one new fact, the agent's **tool state**.

1. **Runtime** (`CleanSlice/runtime`, 0.39.0 → 0.40.0). A tool server that fails to open at boot is remembered instead of dropped, retried in the background with a growing pause, and tried once more before a turn; its tools are swapped into the live registry when it answers. A call that dies on a broken connection is reopened and repeated once when the tool only reads. The runtime tells the hub what state its tools are in, and tells the model, per turn, which servers are missing.
2. **API**. The hub keeps the last tool state each connected agent reported, relays a names-free summary to every console and visitor, serves the detail to people who manage the agent, and opens an incident when an agent stays limited past a threshold.
3. **Consoles** (`admin` + `app`, share page included). The start-up line names what the agent is waiting for; a running agent can carry a "limited tools" mark. The composer is never locked: a message the agent cannot take yet waits in a queue of at most three above the input, reorderable, and is sent when the agent is ready and idle.

Nothing here changes what an agent may do; no new agent status, no new table.

## Technical Context

**Language/Version**: TypeScript 5 — NestJS 10 on Node 20 (`api`), Nuxt 3 / Vue 3 (`admin`, `app`), Bun 1.x (`runtime`)

**Primary Dependencies**: Prisma, socket.io (hub ↔ runtime, hub ↔ consoles), `@modelcontextprotocol/sdk` client in the runtime, Pinia, `@vueuse/core`, reka-ui. No new dependency.

**Storage**: PostgreSQL — no schema change (`AgentEvent.status` / `AgentIncident.status` are strings and take the new value `limited`). Tool state lives in the hub's memory beside the agent's socket. The queue lives in the browser's `localStorage`.

**Testing**: `cd api && bun run test` (jest); `bun test slices` in `admin` and `app`; `bun test` in the runtime; `bun run typecheck`, `bun run locale:check`, `bun run i18n:check`, `bun run test:scripts` at the root.

**Target Platform**: Kubernetes (Hetzner for CleanSlice, EKS for the Mazda fork); evergreen browsers.

**Project Type**: Web application — one API, two consoles — plus the agent runtime in its own repository.

**Performance Goals**: tools back within 60 s of the server answering (SC-001); pre-turn attempt adds ≤ 3 s to an answer (FR-002); composer usable within 2 s of opening a chat (SC-005).

**Constraints**: an old runtime against the new API and a new runtime against an old API must both behave exactly as today (Mazda runs API 0.3.79 with runtime 0.34.1). Server names, addresses and error text never reach a User or a visitor (FR-012). The public status stream stays free of anything sensitive.

**Scale/Scope**: tens of agents per Ranch, 1–5 tool servers each; a queue of ≤ 3 messages per conversation per browser.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | How |
|---|---|---|
| I. The slice is the unit | Pass | Tool state belongs to `api/src/slices/agent/agent` (it is a fact about an agent); the hub only carries it. The queue belongs to the `bridle` slice of each console. Nothing new crosses a slice except through the existing `agent` ↔ `bridle` seams (`agentEvents$`, `sendToAgentClients`). |
| II. Twin consoles | Pass | `bridle` and `agent` are twin slices; every queue and status change is specified for both in [contracts/ui.md](./contracts/ui.md), with the differences that already exist between them named in [research.md](./research.md) R9. The share page rides on the `app` chat. |
| III. Secrets stay behind `api/` | Pass | The runtime's report carries server names and error text only; the API strips both before anything leaves for a non-manager. Error text is cut to 300 characters and passed through the same redaction as `statusReason`. No token, header or URL query is ever reported. |
| IV. One entity, one store | Pass | Tool state is a field of the agent record in the existing agent/status stores, patched by the existing push. The queue is state of the conversation in the existing bridle store, with its storage key built in `bridle/utils/storageKeys.ts`. |
| V. The console is a window, the chat is the hands | Pass | The console shows tool state; `get_agent_status` (already `manage-agent`, `effect: 'read'`) returns the same block. The queue is a property of the composer, not a console capability over Ranch data — it has no tool, by the same reasoning that a draft has none. |
| VI. English is the source | Pass | `app` strings go into `en.json` of `bridle` and `agent` and are generated by `bun run i18n:sync`; `admin` stays English literals. The plain-words notice for visitors is a key, chosen in script by state. |
| VII. A rule stays a rule | Pass | "May this call be repeated" is decided by the tool's declared effect, not by the model. "Is the agent ready for the next queued message" is one function per console. "Limited" is derived from the report by one function in the API. The model is told the state; it does not judge it. |

**Post-design re-check (after Phase 1)**: unchanged — no violation, nothing to track.

## Project Structure

### Documentation (this feature)

```text
specs/035-tool-reconnect-chat-queue/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── runtime.md      # reconnect rules, the report, the prompt block
│   ├── api.md          # hub events, routes, the incident, the tool
│   └── ui.md           # status line, limited mark, queue — both consoles
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
runtime/  (CleanSlice/runtime, branch feat/CLEAN-245-tool-reconnect)
└── src/
    ├── index.ts                                   # report wiring; loadAll no longer the only attempt
    └── slices/
        ├── setup/mcp/
        │   ├── domain/mcp.gateway.ts              # IMcpGateway: + status(), settle(), onChange()
        │   ├── domain/mcp.service.ts              # retry loop owner; swaps tools in on success
        │   ├── domain/toolState.ts                # NEW pure: phase from servers + boot time
        │   ├── domain/retryPolicy.ts              # NEW pure: backoff, what is a broken connection, what is a refusal
        │   └── data/mcp.gateway.ts                # pending servers kept; withSession widened; read-only retry
        ├── setup/channel/…/bridle/bridle.repository.ts   # emit `tool_state` on register and on change
        ├── agent/agent/domain/prompts/toolServers.prompt.ts   # NEW per-turn block
        ├── agent/agent/domain/agent.service.ts    # + section
        └── runtime/runtime/domain/runtime.service.ts      # pre-turn settle; feeds the block

api/src/slices/
├── agent/agent/
│   ├── domain/toolState.types.ts                  # NEW
│   ├── domain/toolState.ts                        # NEW pure: summary, redaction, audience view
│   ├── domain/agentToolState.service.ts           # NEW: holds reports, alert sweep
│   ├── domain/agentStatusFrame.ts                 # + tools
│   ├── domain/agentStatusService.ts               # stream merges tool-state changes
│   ├── agent.controller.ts                        # GET :id/tool-state; AgentDto.toolState
│   ├── agentAdmin.tool.ts                         # get_agent_status returns tools
│   └── dtos/agentToolState.dto.ts                 # NEW
├── agent/event/
│   ├── domain/agentEvent.types.ts                 # + 'limited'
│   ├── domain/agentEvent.service.ts               # recordLimited / noteToolsBack
│   └── domain/notificationText.ts                 # wording for limited
└── bridle/
    ├── handlers/bridleAgentWs.handler.ts          # on `tool_state`
    ├── data/bridle.gateway.ts                     # carries state per agent; agent_status + tools
    └── domain/bridle.types.ts                     # event types

admin/slices/
├── bridle/
│   ├── stores/bridle.ts                           # queue on the conversation; drain
│   ├── utils/queue.ts                             # NEW pure
│   ├── utils/storageKeys.ts                       # + queueKey
│   ├── composables/useQueueOrder.ts               # NEW (pointer + keyboard)
│   └── components/bridle/{Provider.vue,Input.vue,queue/Provider.vue,queue/Item.vue}
└── agent/agent/
    ├── utils/agentSummary.ts, utils/toolState.ts  # labels, one derivation
    ├── stores/agentStatus.ts                      # + tools from the frame
    ├── composables/useAgentLifecycle.ts           # overlay names the wait
    └── components/agent/{chat/Tab.vue,status/Dot.vue,status/ToolState.vue,workspace/RailItem.vue}

app/slices/
├── bridle/
│   ├── stores/bridle.ts                           # queue map; agentTools map; drain
│   ├── utils/queue.ts, utils/storageKeys.ts
│   ├── composables/useQueueOrder.ts
│   ├── components/bridle/chat/{Provider.vue,Input.vue,Queue.vue,QueueItem.vue}
│   └── i18n/locales/en.json (+ generated ru)
├── agent/{utils/agentStatus.ts,components/agent/chat/Provider.vue,workspace/RailItem.vue,i18n/locales/en.json}
└── share/utils/shareInfo.ts, i18n/locales/en.json # plain-words notice

docs/
├── state.md              # the queue's storage key and its sweep step
└── operations/…          # the limited incident, the two thresholds
```

**Structure Decision**: existing slices only. One new service in `agent/agent` (the API side of tool state), one new component folder per console (`queue`), pure rule modules beside each. The runtime work is a separate branch and pull request in `CleanSlice/runtime`, released first.

## Delivery order

1. **Runtime 0.40.0** — reconnect, report, prompt block. Safe against today's API: the hub ignores an event it has no handler for.
2. **API** — hub handler, summary on `agent_status` and the status frame, `GET /agents/:id/tool-state`, incident, tool. Safe against old runtimes: no report means `toolState` is `null` and every console shows what it shows today.
3. **Consoles** — status line and limited mark (needs 2), then the queue (needs nothing from 1–2 beyond a `tools` field it treats as optional).
4. One Ranch release for 2–3; agents are restarted to pick up the runtime; the Mazda replay from [quickstart.md](./quickstart.md) is run on the local cluster before the release and the status checks after it.

## Complexity Tracking

No violations.
