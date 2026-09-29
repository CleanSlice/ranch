# Inventory: where a value's language is decided

Every place in both consoles where a produced value gets its language (FR-018).
Taken on 2026-09-29 at `origin/main` `856eb7e1`. Tests and the generated SDK are
excluded. Line numbers are as of that commit.

Each entry ends as `corrected` or `confirmed correct`. None may stay `open`
(SC-005). Closed on 2026-09-29: `bun run locale:check` reports no findings over
898 files.

## Admin — 57 entries

| Language came from | Entries | What it means |
|--------------------|---------|---------------|
| browser | 41 | follows the operator's browser — the defect |
| fixed `en-US` | 8 | English, 12-hour clock |
| fixed `en` | 3 | English, 12-hour clock |
| fixed `en-GB` | 1 | English, 24-hour clock, day before month |
| fixed `en` via the i18n setting | 3 | relative time; English because admin's only locale is `en` |
| passed in (`'en'`) | 1 | English, decided by the caller |

By slice: agent 19 · bridle 9 · setting 5 · common 4 · reins 4 · user 4 ·
usage 3 · chat 2 · paddock 2 · sessions 2 · llm 1 · setup 1 · share 1.

The reported timestamp is entries 29 and 30.

| # | Slice | Location | Kind | Language came from | Outcome |
|---|-------|----------|------|--------------------|---------|
| 1 | agent | `admin/slices/agent/agent/components/agent/logs/BarSummary.vue:50` | count | fixed en-US | corrected |
| 2 | agent | `admin/slices/agent/agent/components/agent/workspace/Main.vue:139` | relativeTime | fixed en (via i18n) | corrected |
| 3 | agent | `admin/slices/agent/agent/pages/agents/index.vue:25` | instant order | browser | corrected |
| 4 | agent | `admin/slices/agent/agent/utils/agentLogs.ts:109` | dayDivider | fixed en-US | corrected |
| 5 | agent | `admin/slices/agent/file/components/agentFile/ExplorerRow.vue:93` | dateTime | browser | corrected |
| 6 | agent | `admin/slices/agent/file/components/agentFile/Provider.vue:204` | modified | browser | corrected |
| 7 | agent | `admin/slices/agent/file/components/agentFile/Provider.vue:214` | dateTime | browser | corrected |
| 8 | agent | `admin/slices/agent/file/components/agentFile/Provider.vue:215` | dateTime | browser | corrected |
| 9 | agent | `admin/slices/agent/file/components/agentFile/Tree.vue:70` | nameOrder | browser | corrected |
| 10 | agent | `admin/slices/agent/file/components/agentFile/TreeNode.vue:54` | dateTime | browser | corrected |
| 11 | agent | `admin/slices/agent/file/stores/agentFile.ts:152` | nameOrder | browser | corrected |
| 12 | agent | `admin/slices/agent/file/utils/fileTree.ts:104` | nameOrder | browser | corrected |
| 13 | agent | `admin/slices/agent/file/utils/format.ts:21` | modified | browser | corrected |
| 14 | agent | `admin/slices/agent/file/utils/format.ts:24` | modified | browser | corrected |
| 15 | agent | `admin/slices/agent/file/utils/format.ts:26` | modified | browser | corrected |
| 16 | agent | `admin/slices/agent/secret/components/agentSecret/Provider.vue:47` | dateTime | browser | corrected |
| 17 | agent | `admin/slices/agent/secret/components/agentSecret/Provider.vue:132` | nameOrder | browser | corrected |
| 18 | agent | `admin/slices/agent/template/components/template/item/Provider.vue:68` | date | browser | corrected |
| 19 | agent | `admin/slices/agent/template/components/template/list/Provider.vue:35` | date | browser | corrected |
| 20 | bridle | `admin/slices/bridle/components/bridle/DebugPanel.vue:160` | timeWithSeconds | fixed en-GB | corrected |
| 21 | bridle | `admin/slices/bridle/components/bridle/DebugPanel.vue:219` | count | browser | corrected |
| 22 | bridle | `admin/slices/bridle/components/bridle/DebugPanel.vue:454` | count | browser | corrected |
| 23 | bridle | `admin/slices/bridle/components/bridle/DebugPanel.vue:460` | count | browser | corrected |
| 24 | bridle | `admin/slices/bridle/components/bridle/DebugPanel.vue:466` | count | browser | corrected |
| 25 | bridle | `admin/slices/bridle/components/bridle/Message.vue:39` | time | fixed en | corrected |
| 26 | bridle | `admin/slices/bridle/components/bridle/Message.vue:40` | dateTime | fixed en | corrected |
| 27 | bridle | `admin/slices/bridle/components/bridle/ProposalCard.vue:37` | time | fixed en | corrected |
| 28 | bridle | `admin/slices/bridle/utils/chatFlow.ts:130` | dayDivider | passed in (`'en'`) | corrected |
| 29 | chat | `admin/slices/chat/utils/transcript.ts:100` | messageTime | browser | corrected |
| 30 | chat | `admin/slices/chat/utils/transcript.ts:107` | messageTime | browser | corrected |
| 31 | common | `admin/slices/common/components/date/TimeAgo.vue:10` | relativeTime | fixed en (via i18n) | corrected |
| 32 | common | `admin/slices/common/components/date/TimeAgoInline.vue:12` | relativeTime | fixed en (via i18n) | corrected |
| 33 | common | `admin/slices/common/utils/formatDate.ts:3` | dateTime | fixed en-US | corrected |
| 34 | common | `admin/slices/common/utils/formatDate.ts:9` | date | fixed en-US | corrected |
| 35 | llm | `admin/slices/llm/components/llm/usage/Provider.vue:5` | count | fixed en-US | corrected |
| 36 | paddock | `admin/slices/paddock/components/paddock/evaluation/list/Provider.vue:54` | dateTime | browser | corrected |
| 37 | paddock | `admin/slices/paddock/components/paddock/evaluation/Provider.vue:371` | nameOrder | browser | corrected |
| 38 | reins | `admin/slices/reins/components/knowledge/list/Provider.vue:37` | dateTime | browser | corrected |
| 39 | reins | `admin/slices/reins/domain/format.ts:43` | date | browser | corrected |
| 40 | reins | `admin/slices/reins/domain/format.ts:48` | dateTime | browser | corrected |
| 41 | reins | `admin/slices/reins/domain/format.ts:54` | time | browser | corrected |
| 42 | sessions | `admin/slices/sessions/components/session/Detail.vue:65` | dateTime | browser | corrected |
| 43 | sessions | `admin/slices/sessions/components/session/List.vue:33` | dateTime | browser | corrected |
| 44 | setting | `admin/slices/setting/components/setting/Form.vue:79` | time | browser | corrected |
| 45 | setting | `admin/slices/setting/components/setting/github/StatusCheck.vue:88` | time | browser | corrected |
| 46 | setting | `admin/slices/setting/components/setting/github/StatusCheck.vue:101` | time | browser | corrected |
| 47 | setting | `admin/slices/setting/pages/settings/auth.vue:39` | time | browser | corrected |
| 48 | setting | `admin/slices/setting/pages/settings/knowledge.vue:189` | time | browser | corrected |
| 49 | setup | `admin/slices/setup/theme/components/ui/chart/ChartTooltipContent.vue:98` | count | browser | corrected |
| 50 | share | `admin/slices/share/composables/useShareLink.ts:60` | date | browser | corrected |
| 51 | usage | `admin/slices/usage/components/usage/Line.vue:57` | count | fixed en-US | corrected |
| 52 | usage | `admin/slices/usage/components/usage/Panel.vue:127` | amount | fixed en-US | corrected |
| 53 | usage | `admin/slices/usage/components/usage/Panel.vue:132` | count | fixed en-US | corrected |
| 54 | user | `admin/slices/user/apiKey/components/apiKey/CreateDialog.vue:63` | dateTime | browser | corrected |
| 55 | user | `admin/slices/user/apiKey/components/apiKey/CreatedKeyDisplay.vue:107` | dateTime | browser | corrected |
| 56 | user | `admin/slices/user/apiKey/components/apiKey/List.vue:24` | dateTime | browser | corrected |
| 57 | user | `admin/slices/user/user/components/user/item/Provider.vue:20` | date | browser | corrected |

**Entry 28** is one decision on two lines: the check reports `chatFlow.ts:121` (the
formatter's type) as well as `:130` (where it is built), so it counts 58 findings in admin
where the inventory counts 57 entries. Verified 2026-09-29 by running the check on the
untouched tree: every other location matches, admin and app.

**Entry 3** sorts agents by `updatedAt`, an ISO timestamp, using a text
comparison. The result is right in every browser because the text is ASCII, but
it is a text comparison of instants; it becomes a comparison of instants.

## App — language-sensitive calls, 9 entries

All nine already take the active language. They are listed because the format
module becomes the only place such a call may live, so each moves there.

| # | Slice | Location | Kind | Language came from | Outcome |
|---|-------|----------|------|--------------------|---------|
| 1 | bridle | `app/slices/bridle/components/bridle/chat/Message.vue:37` | time | active language | corrected |
| 2 | bridle | `app/slices/bridle/components/bridle/chat/Message.vue:45` | dateTime | active language | corrected |
| 3 | bridle | `app/slices/bridle/components/bridle/chat/ProposalCard.vue:56` | time | active language | corrected |
| 4 | bridle | `app/slices/bridle/components/bridle/chat/Provider.vue:114` | dayDivider | active language | corrected |
| 5 | bridle | `app/slices/bridle/utils/chatFlow.ts:110` | dayDivider | active language | corrected |
| 6 | chat | `app/slices/chat/components/chat/detail/Provider.vue:90` | dateTime | active language | corrected |
| 7 | chat | `app/slices/chat/utils/transcript.ts:9` | messageTime | active language | corrected |
| 8 | chat | `app/slices/chat/utils/transcript.ts:16` | messageTime | active language | corrected |
| 9 | share | `app/slices/share/components/share/panel/Provider.vue:69` | date | active language | corrected |

## App — server and error text, 10 entries

What the server sends is shown as received, in every language (research D10).
The entries below are about the console's **own** English: the message it
writes when the server sent nothing. Entries that are stored but never rendered
are listed under "Latent" below.

| # | Slice | Location | What is shown | Outcome |
|---|-------|----------|---------------|---------|
| 1 | user | `app/slices/user/auth/data/authError.mapper.ts:34` | "Network error — check your connection…" | corrected |
| 2 | user | `app/slices/user/auth/data/authError.mapper.ts:44` | server sentence (stays), else the console's "Your session has ended." | corrected |
| 3 | user | `app/slices/user/auth/data/authError.mapper.ts:49` | "Incorrect email or password." | corrected |
| 4 | user | `app/slices/user/auth/data/authError.mapper.ts:53` | "Too many attempts…" | corrected |
| 5 | user | `app/slices/user/auth/data/authError.mapper.ts:58` | server sentence (stays), else the console's "You don't have access to do that." | corrected |
| 6 | user | `app/slices/user/auth/data/authError.mapper.ts:62` | server sentence (stays), else the console's "Something went wrong…" | corrected |
| 7 | user | `app/slices/user/auth/components/auth/common/Form.vue:268` | renders 1–6 verbatim; fed by the login, register and session-ended providers | corrected |
| 8 | agent | `app/slices/agent/components/agent/chat/Provider.vue:53` | transport detail alone in the restart banner, with no line from the console saying what failed | corrected |
| 9 | bridle | `app/slices/bridle/data/bridle.gateway.ts:129` | hub sentence inside `chat.error_message` (stays), else the console's "Message could not be delivered" | corrected |
| 10 | bridle | `app/slices/bridle/components/bridle/chat/ProposalCard.vue:148` | server `reason` after a translated "Refused" — received text, shown as is | confirmed correct |

## App — interface text that bypasses translation, 12 entries

| # | Slice | Location | What is shown | Outcome |
|---|-------|----------|---------------|---------|
| 1 | agent | `app/slices/agent/components/agent/Item.vue:9` | raw agent status | corrected |
| 2 | common | `app/slices/common/components/landing/hero/AgentCard.vue:24` | raw agent status | corrected |
| 3 | agent | `app/slices/agent/components/agent/chat/Provider.vue:102` | unknown status shown as is — an unknown status is received text and stays as it is; known ones already had keys | confirmed correct |
| 4 | agent | `app/slices/agent/components/agent/workspace/RailItem.vue:69` | unknown status shown as is — same: unknown shown as received, known ones already translated | confirmed correct |
| 5 | bridle | `app/slices/bridle/components/bridle/chat/ProposalCard.vue:76` | raw proposal mode | corrected |
| 6 | bridle | `app/slices/bridle/components/bridle/chat/ProposalCard.vue:132` | raw row action | corrected |
| 7 | common | `app/slices/common/components/layout/Provider.vue:62` | raw user role | corrected |
| 8 | chat | `app/slices/chat/components/chat/detail/Provider.vue:224` | raw sentiment | corrected |
| 9 | chat | `app/slices/chat/components/chat/detail/Provider.vue:230` | language code | corrected |
| 10 | bridle | `app/slices/bridle/components/bridle/chat/Provider.vue:118` | fallback name "Agent" inside a translated sentence | corrected |
| 11 | chat | `app/slices/chat/components/chat/message/Bubble.vue:86` | tooltip sentence joined in the template | corrected |
| 12 | bridle | `app/slices/bridle/components/bridle/chat/AttachmentChip.vue:98` | progress line joined in the template, empty `{name}` | corrected |

## App — numbers and units, 9 entries

| # | Slice | Location | What is shown | Outcome |
|---|-------|----------|---------------|---------|
| 1 | bridle | `app/slices/bridle/domain/attachment.constants.ts:113` | byte size, English unit, decimal point; also feeds the size-limit messages | corrected |
| 2 | bridle | `app/slices/bridle/components/bridle/chat/ProposalCard.vue:61` | second byte formatter, rounds differently | corrected |
| 3 | bridle | `app/slices/bridle/components/bridle/chat/AttachmentChip.vue:98` | `%` placed by hand | corrected |
| 4 | bridle | `app/slices/bridle/components/bridle/chat/ProposalCard.vue:86` | counts without grouping | corrected |
| 5 | bridle | `app/slices/bridle/components/bridle/chat/ProposalCard.vue:90` | counts without grouping | corrected |
| 6 | bridle | `app/slices/bridle/components/bridle/chat/ProposalCard.vue:118` | count passed into a message as plain text | corrected |
| 7 | chat | `app/slices/chat/components/chat/detail/Provider.vue:200` | count without grouping | corrected |
| 8 | chat | `app/slices/chat/components/chat/list/Card.vue:62` | count passed into a message as plain text | corrected |
| 9 | common | `app/slices/common/components/landing/hero/Provider.vue:68` | `99.9%` written in the template | corrected |

## App — confirmed correct, left as written

| Location | What | Why it stays |
|----------|------|--------------|
| `app/slices/bridle/components/bridle/chat/Input.vue:215`, `:218` | `Enter`, `Shift+Enter` | the label printed on the key |
| `app/slices/chat/components/chat/detail/Provider.vue:271` | `MD`, `JSON`, `CSV` | format names |
| `app/slices/common/components/landing/hero/Provider.vue:117`, `:122` | `Scout`, `500m`, `512Mi` | a proper name; Kubernetes quantities |
| `app/slices/agent/components/agent/Item.vue:22` | agent CPU and memory | Kubernetes quantities |
| `app/slices/bridle/components/bridle/chat/Provider.vue:196`, `Message.vue:70` | fallback "Agent" | only its first letter is drawn, as an avatar |
| `app/slices/bridle/stores/bridle.ts:850`, `:868` | server code in brackets | an identifier quoted to support |
| `app/slices/bridle/components/bridle/chat/Thinking.vue:104` | reasoning steps | written by the agent |
| `app/slices/chat/components/chat/detail/Provider.vue:237`, `:252` | summary, topic | written by a model about the chat |

## App — latent, nothing reaches a customer today

| Location | What |
|----------|------|
| `app/slices/agent/stores/agent.ts:89`, `:102`, `:119` | error text stored, never rendered |
| `app/slices/share/stores/share.ts:30`, `app/slices/share/domain/share.gateway.ts:13` | same; the panel shows a translated key |
| `app/slices/user/auth/composables/useRegistrationEnabled.ts:34` | same |
| `app/slices/setup/error/**` | builds a key from a message and toasts it; no toaster is mounted |

Left alone. Recorded so that whoever starts rendering one of them knows it
carries English.

## API — 1 entry

| # | Location | What | Outcome |
|---|----------|------|---------|
| 1 | `api/src/slices/agent/peer/peerSelf.tool.ts:248` | Russian trigger word in a tool description shown in the admin tool catalog | corrected |

## The page itself — 2 entries

| # | Console | What | Outcome |
|---|---------|------|---------|
| 1 | admin | `<html lang>` not set; browser may offer to translate | corrected |
| 2 | app | `<html lang>` not set and does not follow the active language | corrected |

## Shared-area review

One row per slice that exists in both consoles. Filled in as the work lands and
repeated in the pull request.

| Slice | Admin | App |
|-------|-------|-----|
| agent | 19 entries moved onto the format module: log day label, file explorer dates and name order, secrets, templates, "deployed … ago". Log lines themselves untouched. | Status shown through `status.*` in the two components that showed it raw; the restart banner says what failed before the transport detail. No dates to move — app has no agent dates outside relative time. |
| bridle | Message time and tooltip, proposal time, debug panel clock and token counts, day divider. `chatFlow` keeps its `locale` option for the twin's sake and no longer reads it. | Same four date kinds moved onto the module; sizes, counts and percent localised; mode and action through keys; the size limit travels as a number and is worded when shown. `chatFlow` still formats by `locale` — that is the rule on this side. |
| chat | The reported timestamp, `formatMessageTime`, now English in every browser. | `formatMessageTime` delegates to the module and `locale` became required; counts, sentiment, language name and the attachment tooltip localised. |
| common | Gained `utils/format.ts` and `composables/useRelativeTime.ts`; `formatDate.ts` folded into the module; both relative-time components use it. | Gained `utils/format.ts` and `composables/useFormat.ts`; role shown through `role.*`; landing numbers and percent localised; `unit.*` and `value.unknown` added. |
| setup | Chart tooltip numbers; `<html lang="en" translate="no">`. | `<html lang>` follows the active language. The i18n setup itself needed nothing: detection and the cookie are the decided behaviour. |
| share | "Shared since" date. | "Shared since" date. The same defect shape on both sides and the same fix. |
| user | API key and user dates. Admin has no sign-in error mapper of its own to change. | Sign-in errors: the console's six fallbacks became keys, the server's sentence is carried as received. Admin needed nothing here — its copy is English by rule. |

## Totals

| | Entries |
|---|---------|
| Admin, language-sensitive calls | 57 |
| App, language-sensitive calls | 9 |
| App, server and error text | 10 |
| App, interface text | 12 |
| App, numbers and units | 9 |
| API | 1 |
| The page itself | 2 |
| **Total** | **100** |
| Corrected | 97 |
| Confirmed correct | 3 |
| **Open** | **0** |
