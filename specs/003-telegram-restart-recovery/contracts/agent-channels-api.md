# Contract: Ranch Agent Channels REST API (changes)

Base: existing `agents` controller, JWT + Owner/Admin roles — unchanged.

## `GET /agents/:id/channels` (operationId: `getAgentChannels`)

Response items extend `AgentChannelDto`:

```jsonc
[
  {
    "type": "telegram",
    "config": { "botToken": "123:abc", "botName": "my_bot", "adminIds": "111" },
    "connected": false,          // NEW: boolean | null (null = unknown / no status reported yet)
    "statusReason": "Invalid token: 401 Unauthorized",  // NEW: string | null
    "statusUpdatedAt": 1754550000000                    // NEW: number | null (unix ms)
  }
]
```

Behavior:
- Config source: `data/channels/telegram.json`; fallback to legacy `data/channels.json` when absent. Tombstoned channels are omitted.
- Status source: `data/channels/status.json` (merge by type; absent ⇒ `connected: null`).
- `[]` when nothing configured. Update the `@ApiOperation` summary (still references the legacy path).

## `PUT /agents/:id/channels` (operationId: `setAgentChannels`)

Request body unchanged (`SetAgentChannelsDto`: exhaustive channel list; `[]` clears all).

Behavior changes:
- Writes per-channel files (`data/channels/<type>.json`) via read-modify-write preserving runtime-owned fields (`groups`); clears `removed` when setting credentials.
- Channels omitted from the list get a tombstone write (`{ "removed": true }`), not a file delete; the legacy file is left untouched.
- Response mirrors the next `GET` (tombstoned omitted; fresh status merge).
- Update the `@ApiOperation` summary (legacy path + "restart to pick up env vars" wording — restart is still required for panel-side edits to reach a running agent, but the storage description changes).

## Env injection (internal, `argo-workflow.gateway.ts` → `buildAgentEnv`)

- Continues to source Telegram config from `channelGateway.getForAgent(agentId)` — inherits the new path + fallback automatically.
- MUST NOT inject `TELEGRAM_*` env vars for a tombstoned channel.
- `GET /agents/:id/env` preview inherits the same behavior (single source: `buildAgentEnv`).

## SDK regeneration

`admin` and `app` clients are generated (`@hey-api/openapi-ts`, `bun run build:api` with the API's swagger available). DTO extension is additive — no breaking client changes expected; regenerate and commit `*.gen.ts`.

## UI contract (admin Channels tab)

- Show per-channel status badge: connected (green) / disconnected + reason (destructive) / unknown (muted) from the new DTO fields.
- Replace the card description copy (`Provider.vue:197-202`): storage is per-channel `data/channels/<type>.json`; agent-side (chat) changes apply immediately; panel-side changes still need an agent restart for env re-injection.
