# Contract: what the consoles show (CLEAN-240)

Sketches fix the structure and the click counts, not the pixels. `admin` is
English-only; `app` copy goes through `en.json` + `i18n:sync`.

## A. The assistant's page (`admin`, Owner only) — card "Who can use the assistant"

```
┌ Who can use the assistant ─────────────────────────────────────────────┐
│ The Owner always has everything.                                        │
│                                                                         │
│ Admins   [● on ]   ( Basic | Standard | ●Full )     Advanced ›   4 accounts │
│ Users    [● on ]   ( ●Basic | Standard )            Advanced ›  12 accounts │
│                                                                         │
│ Different for these accounts                                            │
│  Jane Doe · Admin     Standard          set by you, Nov 20    Open · Reset │
│  Sam Lee  · User      Off               set by Ann, Nov 18    Open · Reset │
│ — or —  Everyone follows their role.                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

- Switch and level save on their own (one click + the save that follows it
  counts as the "3 clicks, save included" of SC-002: open page, click level,
  confirm). No separate Save button for these two controls; a toast with Undo.
- Narrowing a role (a lower level, or off) asks once: "12 Users lose 21
  abilities. Change?" Widening does not ask.
- Off greys the level and Advanced for that row.
- Users show two levels; a hint on hover says Full is the same as Standard for
  Users.
- A level that is custom reads `Custom · 96 of 157` in place of the segmented
  control's selection, with the three levels still clickable.
- One-time notice above the card after the update: "Users now start on Basic.
  3 Users manage agents and can no longer do it through the assistant. [Raise
  Users to Standard] [Dismiss]".

## B. An account's page (`admin`) — top of the Agent access card

```
┌ Agent access ──────────────────────────────────────────────────────────┐
│ Ranch assistant                                                         │
│  [● on ]  ( Basic | ●Standard | Full )   Advanced ›                     │
│  Set for this account · Use the Admins' setting                         │
│ ───────────────────────────────────────────────────────────────────── │
│ Agents                                                                  │
│  Reaches only these 1                                                   │
│  [ search ]                                                             │
│  OneMazda Intra  ● Running                  ( Default | Allowed | Denied ) │
└─────────────────────────────────────────────────────────────────────────┘
```

- The assistant block saves on its own, independent of "Save access" below.
- With no exception: "Same as all Admins" and the controls show the role's
  values; the first change creates the exception.
- For an Admin editing a User: levels above the Admin's own are disabled with
  "More than you have".
- For the Owner's account: "The Owner always has everything." and no controls.
- No assistant on the installation: "No assistant yet." and no controls.
- The agent list below never contains the assistant; searching its name says
  "The assistant is set above."

## C. Advanced (a Sheet from the right; same component for a role and an account)

```
┌ Admins · what the assistant offers ───────────────────────────── ✕ ┐
│ Start from: ( Basic | Standard | Full )        Custom · 96 of 157    │
│ [ search abilities ]        [ ] Only the ones that change things      │
│                                                                      │
│ ▸ Agents                 [◐]  18 of 20                               │
│ ▾ Agent workspace        [●]  18 of 18            All · None         │
│     [x] Read an agent file                                            │
│     [x] Write an agent file                       changes · deletes  │
│     [x] Set an agent secret                       changes            │
│ ▸ Knowledge              [●]  17 of 17                               │
│ ▸ Users & API keys       [○]   0 of 9                                │
│ ▸ Settings               [◐]   3 of 5      2 more are Owner only     │
│ …                                                                    │
│ Always on: 11 abilities the assistant needs to talk at all  ›         │
│                                                    [Cancel] [Save]   │
└──────────────────────────────────────────────────────────────────────┘
```

- Area switch has three states: on, off, partly on (`aria-checked="mixed"`).
  Clicking partly-on turns the area on.
- Ability rows show the tool's `title`; `changes` for `effect: 'write'`,
  `deletes` for `destructive`.
- Abilities above the role's ceiling are listed disabled with "Owner only" or
  "Admins and above" (FR-025).
- "new" badge on abilities that appeared since the choice was saved.
- "Only the ones that change things" + an area's "None" is the one-minute path
  to "Standard, but nothing destructive" (SC-004) — plus a shortcut button in
  the header: "Untick everything that deletes".
- Picking a level while custom: "This replaces your custom choice." Confirm.
- Nothing is saved until Save; Cancel and ✕ discard.
- Keyboard: areas are an accordion (arrow keys, Enter), checklists are native
  checkboxes, the Sheet traps focus and returns it to "Advanced ›".

## D. The person (`admin` for Admins, `app` for Users)

- Next to the assistant's name in its chat header: a quiet badge with the
  level ("Basic"), opening a popover: the areas with `offered of available`,
  and "The Owner decides what the assistant can do for you."
- Assistant off: the entry is absent (sidebar in `admin`, the hub of the orbit
  in `app`), and its address answers the console's ordinary "not found".

## State

- `admin`: one Pinia store `assistantAccess` — roles, exceptions keyed by
  user id, catalogue (fetched once), per docs/state.md: fetches upsert,
  optimistic changes through `patch()` with rollback.
- `app`: the person's own grant lives in the existing account/agent store
  area as one small store; no settings are edited there.
