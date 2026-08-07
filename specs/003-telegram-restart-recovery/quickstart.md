# Quickstart: Validating Telegram Channel Auto-Recovery

Cross-repo feature: `runtime` (`/Users/maksymtmk/my-knowledge/runtime`) + `ranch` (this repo). Contracts: [channel-files.md](contracts/channel-files.md), [agent-channels-api.md](contracts/agent-channels-api.md).

## Unit / integration tests

**Runtime** (Bun):

```bash
cd /Users/maksymtmk/my-knowledge/runtime && bun test
```

Must cover (new): tombstone resolution in `resolveBootConfigs`, `reconcileFromDisk` picks up a file that appears after construction (simulated S3 pull), token replacement on reconcile, status file written on start success / start failure / removal.

**Ranch API** (Jest; `pretest` runs prisma generate):

```bash
cd /Users/maksymtmk/my-knowledge/ranch/api && bun run test -- agentChannel
```

Must cover (new): per-channel path read, legacy fallback read, status merge (`connected: null` when no status file), PUT writes per-channel + tombstones omitted types + preserves `groups`, env injection skips tombstones.

Typecheck (ranch has no typecheck script): `cd api && npx tsc --noEmit -p tsconfig.json`.

## End-to-end scenarios (acceptance, maps to spec user stories)

Prereq: a deployed agent you can chat with (bridle/panel chat) and a disposable Telegram bot token from @BotFather.

1. **US1 — survives restart (the original bug)**
   - In agent chat: ask the agent to run `channel_telegram_set` with the token → bot answers in Telegram.
   - Restart: delete the pod (or `agent restart` from the panel) and wait for ready (startup probe passes).
   - Send the bot a Telegram DM. **Expected**: reply within 2 minutes of ready, zero manual steps (SC-001).
2. **US2 — status tells the truth**
   - `GET /agents/:id/channels` (or admin tab): `connected: true` shortly after restart.
   - Revoke the token via @BotFather, restart the agent. **Expected**: agent runs, tab + `channel_list` show disconnected with reason within 1 minute of ready (SC-002); no crash loop.
3. **US3 — one configuration, every surface**
   - Configure via chat only → open admin tab=channels. **Expected**: bot listed (SC-004).
   - Redeploy from panel. **Expected**: bot still works (env injected from per-channel file).
   - Mixed-history: set token A via panel, token B via chat, restart. **Expected**: bot B polls; tab shows B (stale legacy never resurfaces).
4. **FR-006 — removal sticks**
   - Remove the channel in chat (`channel_remove`/tool) → restart the agent (pod env still has old token). **Expected**: channel stays off; tab shows none.
5. **Legacy fallback**
   - Agent configured only via panel before this change (legacy `data/channels.json` in S3, no per-channel file). **Expected**: tab still lists it; deploy still injects env; first chat-side edit migrates it to the per-channel file.

## Rollout order

1. Ship + release runtime image first (reconcile is backward-compatible with legacy env injection).
2. Ship ranch (API path convergence + status merge + UI). Ranch release rides `v*` tags (see release memory: version colliding with an existing tag silently skips release).
3. Existing broken agents heal on their next restart — no backfill.
