# Quickstart: seeing it work

How to prove the feature, end to end. Formats are in
[contracts/admin-format.md](contracts/admin-format.md) and
[contracts/app-format.md](contracts/app-format.md); the check is in
[contracts/locale-check.md](contracts/locale-check.md).

## Prerequisites

- Dependencies installed: `bun install` at the repo root.
- The API and both consoles running: `bun run dev` (admin on `:3001`, app on
  `:3000`).
- A browser whose language you can change. In Chrome: Settings → Languages →
  move **Russian** to the top, then restart the browser. A DevTools locale
  override (Sensors → Location → Locale `ru-RU`) also works and needs no
  restart.
- One chat with a message older than today, one agent with files, and one user
  account for the customer console.

## 1. The automated gates

```bash
bun run locale:check        # every value takes its language from the console's rule
bun run i18n:check          # every app key exists in every language
bun test scripts            # the check's own tests
cd admin && bun test slices # format module and slice helpers
cd app && bun test slices
cd admin && npx nuxt typecheck
cd app && npx nuxt typecheck
```

**Expected**: all pass. `locale:check` prints the number of files it read and
`no findings`. Admin typecheck shows the 8 `monaco-editor` errors that `main`
already has, and nothing else.

## 2. The reported defect (Story 1)

Browser language: **Russian**.

1. Open admin → Chats → a chat with a message from a previous day.
2. Read the timestamp under the message.

**Expected**: `Aug 21, 00:46`. Before the change: `21 авг., 00:46`.

## 3. Admin, every screen (Story 1, SC-001, SC-007)

Browser language still **Russian**. Walk these and read every date, time and
number, including tooltips:

| Screen | Look at |
|--------|---------|
| Agents → an agent → Files | modified column, row tooltip, "last synced" line |
| Agents → an agent → Secrets | updated |
| Agents → an agent → Chat | message time, day divider, debug panel time and token counts |
| Templates | created |
| Sessions | list and detail dates |
| Knowledge | list dates, "last finished" |
| Evaluations | run date |
| Settings → any form | "saved at" after saving |
| Settings → GitHub | rate-limit reset time |
| Users → a user, API keys | created, expires |
| Usage | counts, cost, chart tooltip |
| Share link | "shared since" date |

**Expected**: English on every one, the 24-hour clock, and the same format for
the same kind of value wherever it appears. No Cyrillic anywhere on the page
except in content people or the agent wrote.

The browser must **not** offer to translate the page.

## 4. Same text for every operator (SC-003)

Open one admin screen in two browser profiles, one English and one Russian,
side by side.

**Expected**: identical text. Lists sorted by name are in the same order.

## 5. App in each language (Story 2, SC-002)

Browser language: set to **German**, so neither offered language is the
browser's. Sign in, then for **English** and again for **Russian**:

| Screen | Look at |
|--------|---------|
| Agent list and rail | status label, "5m ago" |
| Chat | message time and tooltip, day divider |
| Chat → attach a file | size on the chip, upload progress |
| Chat → attach a file over the limit | the error, including the size in it |
| Chat → a file change proposal | mode, row actions, sizes, line counts |
| Chat history → a chat | message count, sentiment, language |
| Share panel | "shared since" date |
| Header | role |

**Expected**: every value in the selected language — in Russian, `5,9 МБ`, not
`5.9 MB`; a translated status, not `running`. Nothing in German.

## 6. Switching language (SC-004)

1. Open a chat with several messages and an attachment. Language: English.
2. Switch to Russian in the header. Do not reload.

**Expected**: within a second every timestamp, size, count and label on the
screen is Russian. Inspect `<html>`: `lang="ru"`. Switch back: `lang="en"`.

## 7. Server messages (FR-012)

Language: **Russian**.

1. Sign out. Sign in with a wrong password.
2. Stop the API and try to sign in.
3. In a chat, have the agent propose a file change, apply a competing change
   first, then apply the proposal so it is refused.

**Expected**: 1 and 2 are in Russian — the server sent nothing to quote, so the
console speaks for itself. In 3 the word for "Refused" is Russian and the
server's reason follows it exactly as the server wrote it, in English. Repeat in
**English**: the reason is character for character the same.

## 8. Tools in admin (Story 3)

Open the tool catalog in admin chat and read titles, templates and
descriptions, including **Import a peer by address**.

**Expected**: English throughout. Write to the agent in Russian: its answer is
Russian, the timestamp and the tool cards around it are English.

## 9. The check catches a regression (Story 4, SC-006)

On a throwaway branch, make each change, run `bun run locale:check`, then
revert.

| Change | Expected finding |
|--------|------------------|
| Add `new Date().toLocaleString()` to any admin component | L1, with file and line |
| Add `new Date().toLocaleDateString(locale.value)` to any app component | L1 |
| Add `<p>Привет</p>` to an admin component | L2 |
| Add `admin/slices/common/i18n/locales/ru.json` | L3 |
| Put a Cyrillic word in any tool's `title` | L4 |
| Add `<p>Hello</p>` to an app component | L5 |
| Point the check at a directory that does not exist | exit code `2`, not a pass |

**Expected**: every one fails and names the place.

## 10. Inventory closed (SC-005)

```bash
grep -c "| open |" specs/018-english-admin-locale/inventory.md
```

**Expected**: `0`. Every entry reads `corrected` or `confirmed correct`, and the
shared-area review table has a sentence in both columns for all seven slices.
