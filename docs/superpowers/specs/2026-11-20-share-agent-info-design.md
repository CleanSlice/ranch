# Share chat: agent info panel — design (CLEAN-237)

## Intent

A visitor who opens a share link (`/share?token=…`) sees an agent's name and a
status dot, and nothing else. They do not know what the agent is for, what it
can help with, how much they may send, or who reads the conversation. This
change tells them, compactly: one line of description in the header, and an
info button that opens a right-side panel with the rest.

## Goals

- The visitor learns what the agent is for before writing the first message.
- Everything shown is safe for an anonymous person holding only the link.
- The chat keeps its height: the header stays one strip, details live in the
  panel.
- The owner can write the agent's description.

## Non-goals

- A limit per visitor, or a personal "remaining" meter (spec 030 deferred it).
- Showing knowledge bases to visitors (see Calls below).
- The landing page and the embed widget. Only the share page changes.
- Owner-side switches for which sections a visitor sees.

## Anti-goals

- A visitor learning anything about other visitors: how much of a limit is
  used, how many people are talking, when the agent was last busy.
- Anything operational leaking: model, credentials, `statusReason`, resources,
  MCP servers and tools, peers, creator, deploy dates, `allowedOrigins`,
  rotation count.
- An invalid or revoked token answering differently than today (FR-013).

## Constraints

- The visitor page exists only in `app` (`app/slices/share`). `admin/slices/share`
  is the owner's menu. The twin check still applies to every twin slice touched
  (`share`, `agent`): look at the other console and say in the PR why it needed
  nothing or what changed.
- `app` has no shadcn Sheet and no `reka-ui`; `admin` has both
  (`admin/slices/setup/theme/components/ui/sheet`, `reka-ui ^2.9.6`).
- New visitor copy: `en.json` in the slice is the source, `bun run i18n:sync`
  generates `ru`. Numbers and sizes go through `useFormat()`.
- One entity per store: the resolved share lives in `useShareStore().resolved`;
  the new fields extend that object, they do not get a second home.
- Two specs forbid what this change does, and are revised in the same PR:
  - `specs/010-share-agent-link` FR-014 ("no agent details") and the
    "deliberately three fields" comments in the DTO, controller, mapper, types.
  - `specs/030-agent-request-limits`: FR-051 (limit values "visible only to
    roles that may edit the agent. Nothing an anonymous caller can read… may
    expose them") and "The notice in the chat" ("It never shows the limit's
    numbers, how much is used, or how many people are talking"). FR-051
    becomes: configured values may reach a share visitor through
    `/share/resolve`; usage, waits beyond the existing notice, and head-count
    reach no anonymous caller. The notice itself keeps its rule.
    `api/src/slices/agent/limit/limitPrivacy.spec.ts` and the comment in
    `agentLimit.prisma` encode the old rule and change with it: the spec keeps
    guarding every other anonymous surface and names `/share/resolve` as the
    one exception, values only.
- If the change makes a line of `CLAUDE.md` or `.specify/memory/constitution.md`
  wrong, both are fixed in the same PR.

## Approaches

The open choice was how to show limits. The allowance is one per agent, shared
by every visitor (CLEAN-224).

1. **Rules only (picked).** The panel states the configured limits and says
   whose they are: "Up to 20 messages an hour and 100 a day, shared by
   everyone using this agent". When a window is full, the existing
   "Try again in 12:05" notice above the composer does its job, unchanged.
   Nothing about other people's activity is revealed.
2. **Shared usage bar**, claude.ai style. Readable at a glance, but the bar
   moves because of strangers, a visitor reads it as their own remainder, and
   it publishes the agent's load to anyone with the link.
3. **Per-visitor limit with an honest bar.** The right long-term answer for a
   meter, and a separate phase: new limiter keys, storage, and rules for
   visitors without a stable identity.

Picked 1 by the owner of the request: it is the only one that fits today's
shared allowance without leaking load.

## Decided

### What the visitor is told

| Section | Content | Source |
|---|---|---|
| Description | Free text | `Agent.description` → `config.description` → template description → none |
| What it can do | Skill titles and descriptions | Skills of the agent's template |
| Limits | Configured windows, as rules, worded as shared by everyone using the agent | `AgentLimit` (`perMinute` / `perHour` / `perDay`); section absent when no row |
| Attachments | Files per message, size per file, size per message, accepted kinds | `attachment.constants.ts` |
| Status | A word: online / starting / unavailable | `agentStatus`, mapped on the client; never `statusReason` |
| Privacy | "The owner of this agent can read this conversation." | Static copy |

Sections with nothing to say are not rendered. An agent with no description,
no skills and no limits still gets a panel: status, attachments, privacy.

### Layout

```
┌ [SB] Support bot ●              [ⓘ] [New chat] ┐   ┌ About ────────────── ✕ ┐
│      Answers questions about orders…           │   │ Support bot   ● Online  │
├────────────────────────────────────────────────┤   │ Description…            │
│  chat                                          │   │ Can help with           │
│                                                │   │  • Orders  • FAQ        │
│                                                │   │ Limits                  │
└────────────────────────────────────────────────┘   │  20 / hour · 100 / day  │
                                                     │  shared by everyone     │
                                                     │ Attachments             │
                                                     │  5 files · 10 MB each   │
                                                     │ Privacy note            │
                                                     └─────────────────────────┘
```

- Header subtitle: the description, one truncated line. Falls back to today's
  "Powered by…" line when there is no description.
- Info button: icon button in the header, left of "New chat", with an
  accessible name. Opens a Sheet from the right; full width on a phone.
- The panel is not shown in the `loading` and `invalid` states.

### Description field

- New nullable column `Agent.description`, plain text, at most 500 characters,
  trimmed; empty saves as null.
- Accepted on create and update of an agent; returned on `AgentDto`.
- Edited in `admin`, in the agent form next to `name`
  (`admin/slices/agent/agent/components/agent/item/Form.vue`). `app` has no
  place that edits an agent today (its store's `update()` has no caller), so
  there it is shown read-only in the workspace sheet
  (`app/slices/agent/components/agent/workspace/Sheet.vue`). The PR says so
  under the twin check.
- It also appears on `GET /agents/public` through `AgentDto`. Accepted: it is
  text the owner wrote for visitors.
- The A2A agent card's `describe()` reads the column first, then keeps its
  existing fallbacks. The share page uses the same order minus the last
  fallback sentence ("Ranch agent «name».") — a visitor gets no description
  rather than a filler one.
- The Ranch agent can set it: `update_agent`
  (`api/src/slices/rancher/rancher.tool.ts`) accepts `description`
  (docs/agent-tools.md). No new tool is needed for the visitor
  panel itself — it is not a console capability.

### API

`POST /share/resolve` keeps its request, its 400 and its uniform 404. The 200
body grows:

```
agentId, agentName, agentStatus            (unchanged)
description: string | null
skills: { title: string; description: string | null }[]
limits: { perMinute: number | null; perHour: number | null; perDay: number | null } | null
attachments: { maxPerMessage: number; maxFileBytes: number; maxMessageBytes: number; kinds: string[] }
              kinds = family keys the client translates: image, pdf, document,
              spreadsheet, presentation, text
```

- Built in `ShareLinkService.resolveForVisitor` from an explicit allowlist —
  never by spreading an agent, template or limit record.
- `limits` comes from `AgentLimitService.getLimits(agentId)` and carries
  configured values only. No usage, no `retryAfter`, no
  in-flight count.
- `skills` carries no ids, no content, no source URLs.
- The page re-resolves every 30 s, so the panel follows edits without reload.
- A spec asserts the exact key set of the response, so a field added to the
  agent later cannot reach visitors by accident.

### Limits wording

The allowance is one per agent, so a bare "100 a day" reads as a personal
remainder and turns into a broken promise the first time other visitors have
spent it. The limits line always says the allowance is shared by everyone
using the agent — in the sentence itself, not in a tooltip or a footnote. It
still says nothing about how much is used or how many people there are.

Showing the numbers is not a security exposure of its own: anyone can find
them by sending until refused. The exposure that exists — one visitor
spending the whole shared allowance — is there with or without this panel and
is what a per-visitor limit (approach 3) would close.

## Calls made by the designer (not decided by the requester)

- **Knowledge bases are left out.** Their names are often internal ("HR
  policies 2026 draft"), and showing them safely needs an owner switch, which
  is its own change. Skills come from the template and are written to be read.
- **A real column, not `config.description`.** `config` is a free-form bag
  handed to the pod; a field the console edits and visitors read deserves a
  validated home. `config.description` stays as a read-only fallback so the
  agent card does not change for existing agents.
- **500 characters.** Enough for two or three sentences; the header shows one
  line of it anyway.
- **Sheet via `reka-ui` in `app`**, components copied from `admin`'s
  `ui/sheet`, same version as `admin`. Shared behaviour is copied between the
  consoles, per the repo's convention.
- **Attachment kinds shown as families** (images, PDF, documents,
  spreadsheets, presentations, text — CSV, JSON and Markdown count as text),
  not raw MIME types.
- **No agent editing in `app`.** Adding the first edit form to that console is
  a wider change than this ticket; `admin` and the `update_agent` tool cover
  writing the description.
- **Minute window is shown** in the rules alongside hour and day. It is a
  configured value, not a state, so it does not flicker.

## Left to the builder

- Exact copy, in `app/slices/share/i18n/locales/en.json`.
- How the attachment constants reach the service (import vs. a small provider),
  within slice boundaries.
- Migration name and the regenerated OpenAPI client (`build:api` in both
  consoles).

## Verification

- API: resolve returns the new fields; invalid and revoked tokens still give
  the same 404; the key-set spec passes.
- `app`: `nuxt typecheck`, `bun run locale:check`, `bun run i18n:sync` clean.
- By hand on a live stack: an agent with description, skills and limits; one
  with none of them; a phone-width viewport; edit the description in the
  console and see it arrive on an open share page within 30 s.
