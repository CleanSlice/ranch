# Quickstart validation: CLEAN-66 share an agent by public link

Prerequisites: local stack per `README.md` (`make dev`, or `make dev-api` + `make dev-app`; a running agent pod is needed for real replies). Contracts: [contracts/share-link-api.md](./contracts/share-link-api.md); model: [data-model.md](./data-model.md).

## 1. Unit tests (fast loop)

```bash
cd api && bun run test -- shareLink bridle.controller bridleChatAuth attachment
```

Expected green: token format `sl_` + 43 base64url chars; Share is idempotent while active; Revoke sets `revokedAt`; Regenerate/Share-after-revoke rotates the token and bumps `rotationCount`; gateway upsert keeps one row per agent; `resolveClientId` returns `share-<visitor>` for a valid pair, 403 for revoked / other-agent / malformed visitor; `POST /share/resolve` is 404 for unknown and revoked tokens with identical bodies; `BridleChatAuthGuard` passes JWT or share headers and sets `chatClientId`; upload stamps `owner`; visitor download of a foreign `owner` is 404.

## 2. Migration, typecheck, client regen

```bash
cd api && bun run migrate            # creates AgentShareLink (additive)
cd api && bunx tsc --noEmit && bun run build && bun run generate:swagger
cd app && bun run build:api && bun run typecheck
bun run i18n:sync && bun run i18n:check   # from repo root; needs CLAUDE_API_KEY in .env.project
```

Expected: `ShareLinksService` / `ShareService` appear in `app/slices/setup/api/data/repositories/api/sdk.gen.ts`; typecheck passes; `i18n:check` reports no missing/stale keys for `share/` and the agent slice.

## 3. E2E — owner shares, visitor chats, owner revokes

1. Log in to the console (`http://localhost:3001`), open any **running** agent.
2. Header, right side: press **Share**. Expect a panel with `http://localhost:3001/share?token=sl_…`, **Copy**, **Revoke**, **Regenerate**. Press Copy → button shows a check for ~1.5 s, clipboard holds the full URL. Reload the page, reopen the panel → same token (US1).
3. Open the copied URL in an **incognito** window. Expect: no login, no header/nav/rail, only the agent name, the chat and the composer with the paperclip. Send a message → reply arrives (US2). Attach an image and a PDF, send → the agent answers about them; reload → the attachments still open from the bubbles. Reload → the conversation is still there. Open the same URL in a second browser → empty conversation there (isolation). From that second browser, request the first visitor's attachment URL with its own share headers → 404.
4. Back in the console: **Chats** list shows a new session for that agent with the external id `share-…` (FR-012).
5. Owner presses **Revoke** → panel returns to "not shared". In the incognito window: within 30 s (or on the next send) the page shows "This link is no longer active" and the composer is disabled (US3). Reloading the URL shows the same state.
6. Owner presses **Share** again → new token. Old URL still dead; new URL works.
7. With a live visitor page open, owner presses **Regenerate** → old page dies as in step 5, new URL works.
8. Stop the agent from the admin (or scale the pod down). Visitor page shows the "agent unavailable" banner within 30 s; start it again → banner disappears without reload (FR-015).
9. Open `/share?token=garbage` and `/share` without a token → same invalid-link state, no agent name shown (FR-013).
10. While logged in as the owner, open the owner's own share URL → full-view visitor chat, separate from the console conversation (edge case).

## 4. Negative API checks

```bash
# revoked or unknown token → 403, never anonymous fallback
curl -s -X POST localhost:3000/api/agent/<agentId>/message/sync \
  -H 'Content-Type: application/json' -H 'X-Share-Token: sl_nope' -H 'X-Share-Visitor: abc' \
  -d '{"text":"hi"}'          # expect 403 {"code":"SHARE_LINK_INVALID"}
# token for agent A used against agent B → 403
# visitor id with spaces → 403 SHARE_VISITOR_INVALID
# attachment download with a valid share pair but a foreign owner → 404; without any credentials → 401
# owner endpoints without JWT → 401
curl -s localhost:3000/agents/<agentId>/share-link     # expect 401
```
