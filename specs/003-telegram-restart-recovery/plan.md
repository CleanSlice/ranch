# Implementation Plan: Telegram Channel Auto-Recovery After Agent Restart

**Branch**: `fix/telegram-restart-recovery` | **Date**: 2026-08-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-telegram-restart-recovery/spec.md`

## Summary

A Telegram bot configured from agent chat dies on every agent restart: the runtime resolves channel configs from local disk **before** the S3 pull restores them, and no env fallback exists for chat-configured bots. Additionally the platform reads a legacy channel file the runtime no longer writes, so chat-configured bots are invisible in the admin Channels tab and to deploy-time env injection (and mixed histories surface stale tokens). The fix: (1) runtime re-resolves and reconciles channels **after** the S3 pull (`reconcileFromDisk`), (2) platform converges on the runtime's per-channel files with read-only legacy fallback, (3) a runtime-written status file surfaces live connected/disconnected + reason in both chat `channel_list` and the admin tab, (4) removals become tombstones so env fallback can't resurrect them. Full root cause: [research.md](research.md); decisions D1–D6 therein.

## Technical Context

**Language/Version**: TypeScript everywhere. Runtime repo: Bun (bun test, Docker image via ghcr). Ranch: NestJS API (Node), Nuxt 3 / Vue 3 admin, hey-api generated SDK clients.

**Primary Dependencies**: Runtime: `@aws-sdk/client-s3` (existing S3 sync), zod (tool schemas). Ranch API: existing `IFileGateway` (per-agent S3 file access), `@nestjs/swagger`. Admin: existing agentChannel slice components.

**Storage**: Per-agent S3-synced JSON files only (`agents/{id}/data/channels/*`); no database schema changes. Schemas: [data-model.md](data-model.md).

**Testing**: Runtime — `bun test` (existing spec files pattern `*.spec.ts` next to code). Ranch API — Jest (`bun run test`). No E2E automation exists; acceptance is manual per [quickstart.md](quickstart.md).

**Target Platform**: Agents run as k8s pods (namespace `agents`, Argo Workflow-submitted, `restartPolicy: Always`); ranch API/admin deploy via `v*` tag releases.

**Project Type**: Cross-repo — agent runtime (`/Users/maksymtmk/my-knowledge/runtime`) + platform monorepo (`ranch`: `api/`, `admin/`). Spec/plan artifacts live in ranch.

**Performance Goals**: Bot answers ≤2 min after agent ready post-restart (SC-001); operator-visible status accurate ≤1 min (SC-002; S3 watcher debounce 30s fits).

**Constraints**: No destructive data migration (legacy file frozen, read-only fallback); constructor API of `AgentRuntime` unchanged (multi.ts / paddock mock runs); env injection kept as resilience path for failed S3 pulls; last-write-wins concurrency on shared files accepted.

**Scale/Scope**: Dozens of agents per node; 2 runtime slices touched (`setup/channel`, `runtime/runtime`), 3 ranch slices (`agent/agentChannel`, `workflow`, admin `agentChannel` UI), 2 generated SDK clients, UI copy update explicitly requested by the user.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled Spec Kit template — no project-specific principles are ratified. No gates to enforce; proceeding with repo conventions as the de-facto constitution: CleanSlice layered slices (controller/domain/data) in both repos, comments state constraints not narration, tests colocated as `*.spec.ts`. **PASS** (pre-Phase-0 and re-checked post-Phase-1 — design adds no new projects, no new storage, no pattern deviations).

## Project Structure

### Documentation (this feature)

```text
specs/003-telegram-restart-recovery/
├── plan.md              # This file
├── spec.md              # Feature spec (clarified 2026-08-07)
├── research.md          # Root cause + Phase 0 decisions D1–D6
├── data-model.md        # Channel file schemas, DTO extension, precedence rules
├── quickstart.md        # Test commands + E2E acceptance scenarios + rollout order
├── contracts/
│   ├── channel-files.md       # S3 file contract (runtime ⇄ platform) — the real interface
│   └── agent-channels-api.md  # REST DTO/behavior changes + SDK regen + UI contract
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
# Repo 1: runtime (/Users/maksymtmk/my-knowledge/runtime) — primary fix
src/slices/setup/channel/
├── channel.module.ts                    # + reconcileFromDisk(); tombstone in resolveBootConfigs;
│                                        #   removeChannel → tombstone; status writes
├── domain/channel.service.ts            # start() reports per-channel results for status capture
└── data/repositories/telegram/telegramFile.ts   # ITelegramFile.removed; (slackFile.ts same)
src/slices/setup/channel/data/channelFiles.ts    # status.json load/save helpers
src/slices/runtime/runtime/runtime.module.ts     # connectChannels(): await reconcileFromDisk() first

# Repo 2: ranch — platform convergence + status surfacing
api/src/slices/agent/agentChannel/
├── agentChannel.controller.ts           # @ApiOperation summaries (legacy path wording)
├── data/agentChannel.gateway.ts         # per-channel path + legacy fallback + status merge;
│                                        #   PUT → per-channel writes + tombstones, preserve groups
├── data/agentChannel.mapper.ts          # file↔DTO with new status fields
├── domain/agentChannel.types.ts         # ITelegramFileEntry.removed, IChannelStatusFile, comments
└── dtos/                                # AgentChannelDto + connected/statusReason/statusUpdatedAt
api/src/slices/workflow/data/argo-workflow.gateway.ts  # (behavior inherited via gateway; verify tombstone exclusion)
admin/slices/agent/agentChannel/
├── components/agentChannel/Provider.vue # card description copy (user-flagged); status badge + reason
├── data/agentChannel.{gateway,mapper}.ts
└── domain/agentChannel.types.ts
admin & app: slices/setup/api/data/repositories/api/*.gen.ts  # regenerated (bun run build:api)
```

**Structure Decision**: Two coordinated workstreams, one per repo, shipped runtime-first (see rollout order in [quickstart.md](quickstart.md)). All ranch changes stay inside the existing `agentChannel` slices in api/admin plus one verification point in the workflow slice; all runtime changes stay inside `setup/channel` plus a one-line ordering change in `runtime.module.ts`. No new projects, packages, or storage systems.

## Complexity Tracking

No constitution violations — table not required.
