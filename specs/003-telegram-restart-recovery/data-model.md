# Data Model: Telegram Channel Auto-Recovery

All channel state lives in per-agent S3-synced files under `agents/{id}/data/` (S3 side) ⇄ `.agent/data/` (runtime side). No database changes.

## Files

### 1. Per-channel config — `data/channels/telegram.json` (SOURCE OF TRUTH)

Written by: runtime (`channel_telegram_set` tool, group tracking), ranch API (`PUT /agents/:id/channels`).
Read by: runtime boot resolution + reconcile, ranch API (`GET /agents/:id/channels`), env injection at pod submit.

```jsonc
{
  "botToken": "123:abc",        // absent on tombstone
  "botName": "my_bot",           // optional, public @handle without @
  "adminIds": "111,222",         // optional, comma-separated chat ids
  "removed": true,               // NEW — tombstone: channel explicitly removed;
                                 // suppresses env fallback and env injection
  "groups": {                    // registry of groups the bot works in (runtime-owned)
    "<chatId>": {
      "id": "-100123", "type": "group|supergroup|channel",
      "title": "…", "username": "…", "status": "member|administrator|left|…",
      "addedAt": 0, "lastSeenAt": 0
    }
  }
}
```

Rules:
- Writers patch only their fields (read-modify-write) — config writers preserve `groups`, the group tracker preserves config. Cross-writer conflicts stay last-write-wins per file.
- `removed: true` and credentials are mutually exclusive: setting a token clears `removed`; tombstoning drops credentials and `groups`.
- Same shape for `data/channels/slack.json` (`botToken`, `appToken`, `removed`).

### 2. Channel status — `data/channels/status.json` (NEW, runtime-owned, read-only for platform)

Written by: runtime only — on channel start success/failure, replace, stop, removal.
Read by: ranch API (merged into `GET /agents/:id/channels`), optionally admin UI via that endpoint.

```jsonc
{
  "telegram": {
    "connected": true,
    "error": null,               // string when a start attempt failed (e.g. "Invalid token: 401")
    "updatedAt": 1754550000000   // unix ms of last state change
  },
  "bridle": { "connected": true, "error": null, "updatedAt": 0 }
}
```

Rules:
- A missing file or missing key means "unknown" (agent predates the feature or never configured the channel) — platform must render unknown, not disconnected.
- Staleness bound: S3 watcher debounce (default 30s) + platform read; SC-002 budget is 1 minute.

### 3. Legacy config — `data/channels.json` (read-only fallback, frozen)

Object keyed by type: `{ "telegram": { botToken, botName?, adminIds? } }`. Never written again by either side; never deleted. Used by ranch reads only when the per-channel file is absent (pre-existing agents). Runtime's `migrateLegacyChannelFiles` keeps handling the local-disk case.

## Precedence & lifecycle

Resolution order per channel type (runtime boot + reconcile, and platform reads):

1. `data/channels/<type>.json` exists with credentials → use it (overrides env / legacy).
2. `data/channels/<type>.json` exists as tombstone (`removed: true` or no credentials) → channel OFF; ignore env and legacy.
3. No per-channel file → env vars (`TELEGRAM_BOT_TOKEN`…) if set, else legacy `data/channels.json` (platform reads), else no channel.

State transitions:

```
(unconfigured) --set via chat/panel--> configured --start ok--> connected
     ^                                     |--start fail--> disconnected(error)
     |                                     |--remove--> tombstoned
tombstoned --set again--> configured   restart: configured -> reconcile -> connected|disconnected
```

## API DTO (ranch, extends existing `AgentChannelDto`)

```ts
{
  type: 'telegram',
  config: { botToken, botName?, adminIds? },   // unchanged
  connected: boolean | null,                    // NEW — null = unknown (no status yet)
  statusReason: string | null,                  // NEW — failure reason when disconnected
  statusUpdatedAt: number | null                // NEW — unix ms
}
```

`PUT` request body unchanged (exhaustive list of channels with config); omission ⇒ tombstone write. Tombstoned channels are excluded from `GET` responses and from env injection.
