# Quickstart: validating chat message reliability

How to prove the feature works end to end. Shapes and rules are in
[data-model.md](./data-model.md) and [contracts/bridle-socket.md](./contracts/bridle-socket.md);
this file only says what to run and what to expect.

## Prerequisites

- Local stack: `make setup` once, then `make dev` (API :3000, app :3001, admin :3002,
  k3d). At least one agent in `running` state; for the delegation-style multi-message
  turns, Rancher plus one peer.
- An admin login and an app console login.
- Browser DevTools (Network → throttling / Offline, Application → Local Storage).

## Step 0 — Before any fix: capture the evidence (research open items 1 and 3)

1. Pick one conversation that showed fused bubbles after reload. In the admin, open the
   agent's Files → `data/sessions/<sessionKey>.jsonl` and look at one multi-message turn.
   **Record**: is there one `assistant` event for the turn or one per message? Does the
   `user` event's `id` equal the `messageId` the hub forwarded (API log line for the
   send)? This settles research F6 / F7 and the de-duplication rule in D3.
2. Reproduce the ordering bug on purpose: set the OS clock **2 minutes ahead**, send
   "привет" to an agent that replies quickly. **Expected today**: the reply renders
   above the question. Keep the clock skewed for scenario 1 below.
3. Reproduce the handoff: ask a question in the landing-page chat, immediately click
   through to that agent's page. **Record** whether the chat shows "Reconnecting…", and
   whether the answer arrives (research F5).
4. Admin: open the Rancher panel and an agent's Chat tab, start a turn in one, open the
   other. **Record** whether the first chat's messages change (research F3).

## Automated checks

```bash
cd api && bun run test -- bridle transcriptReader   # hub ack, idempotency, replay buffer, reader order
cd app && bun test slices/bridle/utils              # chatFlow ordering, delivery state machine
cd admin && bun test slices/bridle/utils
cd app && npx nuxt typecheck                        # not `bun run typecheck` — it regenerates the SDK
cd admin && npx nuxt typecheck
bun run i18n:sync                                   # after adding keys to app/slices/bridle/i18n/locales/en.json
```

## Manual scenarios

Run each in **both** surfaces unless marked.

### 1 — Order survives clock skew (US2, FR-006/007)

With the OS clock 2 minutes ahead: send a question, wait for a multi-message answer,
send a follow-up while the agent is still working.
**Expect**: question above its answer; follow-up exactly where it was sent; identical
order after a reload. Reset the clock afterwards.

### 2 — Scroll (FR-024/025)

Fill the chat past one screen. Scroll to the top. (a) Wait for an incoming agent message
→ the view **does not move**. (b) Send a message → the view **scrolls to the bottom**
and the new message is visible. (c) At the bottom during a streamed answer → the view
follows the stream.

### 3 — Timestamps (US5, FR-017/018)

Every bubble shows a time of day; hovering shows full date and time; a separator appears
between messages from different days. Reload: every time is unchanged. App in Russian:
separators and states are in Russian; admin is English.

### 4 — Delivery states (US5, FR-019–021)

- Normal network: the message shows no warning state (delivered).
- DevTools throttling "Slow 3G", or pause the API process for ~8 s: a loading state
  appears under the message after ~5 s and clears on delivery.
- Stop the agent (scale to 0 / stop from the admin), send: "not delivered" appears under
  the message with Resend and Discard. **No** "Agent is not connected" agent bubble.

### 5 — Nothing is lost across reload (US1, FR-002–005)

- Send, reload within one second → the message is there once, either delivered or not
  delivered — never missing, never twice.
- With the agent stopped: send, reload → the message is still there, marked not
  delivered. Start the agent, press Resend → it becomes delivered, the agent answers
  **once**, and a further reload shows one copy.
- Discard a not-delivered message, reload → it stays gone.
- Idempotency (a resend whose original did arrive) is not practical to stage by hand; it
  is covered by the hub's jest spec for a repeated `clientMessageId` in the automated
  checks above.

### 6 — Landing page → agent page (US1 scenario 1, app only)

Ask a question in the landing hero chat, click through to the agent page while the agent
is still answering.
**Expect**: the question is the first item, shown once; no "Reconnecting…"; the answer
continues in place; nothing to retype.

### 7 — Two chats at once (admin only)

Rancher panel open with a turn running; open an agent's Chat tab and send there.
**Expect**: each chat keeps its own messages and its own thinking timeline.

### 8 — Answer arrives after a connection gap (US4, FR-014–016)

Start a long turn. DevTools → Offline for ~10 s across the moment the agent finishes
(watch the API log for the `stream_end`), then back Online.
**Expect**: the answer appears without a reload within 10 s of reconnecting; the
thinking indicator ends; no duplicate bubbles. Then repeat, but restart the API during
the gap (buffer lost): the client falls back to the transcript and still shows the
answer.

### 10 — Two views of one conversation (FR-026)

Open the same agent's chat in two tabs (or the admin panel and the app console) under the
same login. Send from the tab that was opened **first**.
**Expect**: both tabs show the question once and the answer once. *Before the fix
(reproduced 2026-09-18 with a scripted client): the sending tab receives nothing and the
other tab receives the answer.*

### 11 — Agent status is the same everywhere (US6, admin only)

Agents screen, an agent selected. Trigger a deploy that ends in `failed` (or `running`).
**Expect**: list row, header pill and Overview card change together within 10 s, no
reload; the failure reason is reachable from the list row. Repeat with a **different**
agent selected: the changing agent's row still updates.

### 9 — Reload looks like live (US3, FR-010–013) — *needs the runtime change*

Agent answers in ≥ 3 messages with a list, inline code and bold text. Screenshot, reload
(admin) and open the same conversation under `/chats` (app), compare.
**Expect**: same number of bubbles, same boundaries, same formatting, no glued sentences.
Until the runtime persists one event per message this scenario is expected to **fail**
for the admin and the history pages, and must be reported as such.

## Success criteria mapping

| Criterion | Scenario |
|-----------|----------|
| SC-001, SC-002 | 5, 6, 8 (scripted ×100 for the numbers) |
| SC-003 | 9 |
| SC-004 | 1, 6 |
| SC-005 | 8 |
| SC-006 | 3 |
| SC-007 | 4 |
