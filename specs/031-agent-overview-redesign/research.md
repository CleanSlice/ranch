# Research: Agent Overview redesign

Decisions taken before design. File references are to `admin/slices/agent/agent/`
at `origin/main` 34bd8c64 unless a path starts elsewhere.

## R1. The section list becomes rows, the vocabulary stays

**Decision**: `workspace/SectionCard.vue` is replaced by a one-line row
(`SectionRow.vue`: icon, name, count), and `workspace/sections.ts` gains a
`group` per section (`null` for Overview, `configure`, `data`, `observe`) and
the new order: overview · knowledge, a2a, channels, secrets, env · files,
chats · logs, events, paddock. `SettingsNav.vue` renders group headings on
desktop and drops them in the horizontal row below `lg`.

Every `value` string, `toAgentTab`, `LEGACY_TAB_ALIASES` and the `?tab=`
handling are untouched, so FR-005 holds by construction. `desc` stays in the
data and becomes the row's tooltip — it is still the only place that says what
"A2A" is.

**Consequences**: `utils/sections.test.ts` pins the old order and is updated
to pin the new order and the groups. `aria-orientation` follows the layout
(vertical on desktop, horizontal in the row). The list is not made `sticky`:
it already stays in view because the content panel scrolls by itself
(`workspace/Canvas.vue:83-88`); FR-007 is met by keeping that.

**Alternatives considered**: keeping the card and shrinking its padding —
still eleven bordered boxes; a collapsible list — hides the thing people
navigate by.

## R2. Overview is rebuilt from six blocks and a strip

**Decision**: `overview/Tab.vue` mounts, in order, `Summary`, `ConfigCard`,
`LimitCard`, `AccessCard`, `UsageCard` (rewritten), `AdvancedCard`,
`DangerCard`, and `SaveBar`. `LlmCard`, `KnowledgeCard`, `MetricsCard`,
`RuntimeCard` and `visibility/Provider.vue` are removed; what they showed
moves as listed in `data-model.md` ("Where each fact goes"), which is the
checklist for FR-009 / SC-007.

`load/Meters.vue` and `load/Chart.vue` are kept and mounted inside
`LimitCard`; `load/Provider.vue` is folded into it.

## R3. Pending changes: one draft for the page

**Decision**: a composable `useAgentDraft(agent, limits)` owns the page's
unsaved edits, provided by `Tab.vue` and injected by the blocks. Its logic is
a pure module `utils/agentDraft.ts` (diff, count, payload, restart need) with
unit tests; the composable only binds it to refs.

- **It is not a second copy of the agent.** It stores only the fields the
  operator touched (`Partial` of the editable fields). A field that was not
  touched renders the store's value and follows it when the status stream or
  a refetch moves it (the pattern `visibility/Provider.vue:120-122` already
  uses). A touched field keeps the operator's value. "Changed" is recomputed
  against the current saved value, so setting a field back by hand clears it
  (FR-017, acceptance 3.6).
- **Editable fields**: `name`, `description`, `llmCredentialId`,
  `knowledgeIds`, `resources.cpu`, `resources.memory`, `debugEnabled`,
  `isPublic`, `allowedOrigins`, and the three limits.
- **Count** in the bar: one per changed field; the three limits and the
  on/off switch count as their fields (switch off = three limits emptied).

**Rationale**: constitution IV. The agent stays once in its store; the draft
is form state that exists only while the page is open (spec, Key Entities).

**Alternatives considered**: a full form copy as on the Edit page today — it
is overwritten or goes stale when the record moves under it, and it sends the
whole form; a Pinia store for the draft — it would outlive the page.

## R4. One save, only what changed

**Decision**: Save builds one `PUT /agents/:id` body from the draft with only
the changed fields (`IUpdateAgentData` already accepts any subset):

- when `isPublic` or a limit changed, it goes through
  `agentLimitStore.save(id, limits, send)` — the existing path that moves the
  limit record and the agent record together, rolls both back on a refusal and
  returns the refusal `code` instead of throwing;
- otherwise through `agentStore.update(id, body)`.

`description` lives in `config.description`. The body carries the **currently
saved** `config` with only `description` set or removed — never a copy taken
when the page opened — so a config change made elsewhere in the meantime is
not undone.

A refusal leaves the draft as it is; the code is placed by the field through
the existing `utils/agentLimitForm.ts` placement, extended with the public
switch (`PUBLIC_AGENT_NEEDS_LIMITS` shows in the Request limit block and by
the landing-page switch).

**Restart**: unchanged rules, made explicit. Fields that came from the Edit
page (name, description, model, knowledge, resources, debug) mark the agent
"pending restart" as that page always did; the public flag and origins do as
the visibility card did; limits never do. When CPU or memory is among the
changes the bar offers "Save and restart" (restart right after a successful
save) next to plain Save.

## R5. Clearing the model credential

**Finding**: the Edit page offers "None", but `data/agent.mapper.ts:165`
turns `null` into `undefined`, so the field is dropped and nothing changes;
the generated DTO is not nullable either.

**Decision**: do not carry a control that silently does nothing. The Model
row lists active credentials only; "None" is offered only if the first
implementation task confirms the API clears the credential when sent `null`
(then the mapper is fixed in the same change). If it does not, clearing a
credential is filed as its own ticket — it needs an API change, and this
feature is `[ADMIN]` only.

## R6. Asking before changes are lost

**Decision**: one guard, `useUnsavedGuard(isDirty)`, built on the existing
`useConfirmStore().ask` and covering every way out:

| Way out | Mechanism |
|---------|-----------|
| Another page | `onBeforeRouteLeave` |
| Another agent, or a `#hash` link (same route, different params) | `onBeforeRouteUpdate` |
| Another section or the Chat tab | a check inside `useAgentTab().setTab` — it only replaces the query, which no route guard sees |
| Closing or reloading the tab | `beforeunload` |

**Rationale**: the report found four places that guard leaving and none that
guard a query-only change, which is exactly how sections switch here.

## R7. Keeping the strip current without waking a hidden tab

**Decision**: the strip reads four sources that already exist — the status
stream (`agentStatusStore`), usage (`useUsageStore.fetchForAgent`), pod
metrics (`agentStore.fetchMetrics`) and request load (`agentLimitStore`,
3 s). Pod metrics move from a bare `setInterval` to the existing
`utils/visiblePoller.ts` at the same 10 s, so they too stop while the tab is
hidden (FR-012). Usage is fetched once per visit; it changes by the hour.

A pod with no limits reported is shown as "not available", not as 0%
(`data/agent.mapper.ts:129-148` maps missing limits to 0 today; the strip
checks for it).

## R8. The request-limit block: shipped rules, the prototype's feedback

**Decision**:

- The switch is a view of the three fields: off = all three empty (which is
  what "limits off" has meant since CLEAN-224), on = at least one filled.
  Switching on focuses the per-minute field; switching off empties the three
  and, for a public agent, is refused at save with the existing code.
- The "what would this limit have done" sentence and the over-limit marking
  are a pure function of the last-hour series and the typed number:
  `limitPreview(series, perMinute)` → `{ over, refused, peak }`, in
  `utils/limitPreview.ts` with tests. It runs on every keystroke; nothing is
  sent.
- Chart scale follows the prototype's rule so traffic stays readable:
  `top = max(peak × 1.25, min(limit, peak × 2.2) × 1.12, 4)`; when the limit
  is above `top` the line sits at the top edge labelled "limit N is above this
  scale" (FR-028). Today's chart does the opposite and flattens the bars.
- `load/Chart.vue` takes a `previewLimit` prop (the typed value) in addition
  to the saved one; `load/Meters.vue` is used as is.
- Presets 10 / 30 / 60 / 120 fill the per-minute field.

The numbers in the scale rule are the prototype's; they are layout constants,
not thresholds.

## R9. Access: chips, a folded embed, no new library

**Decision**: origins become a small chip input written in the slice
(`access/OriginsInput.vue`) — the theme has no TagsInput, and the behaviour is
twenty lines: Enter or comma adds, × or Backspace removes, a pure
`parseOrigin()` validates (scheme + host + optional port, no path, trailing
slash stripped) with tests. Embed code uses the theme's `Accordion` (closed by
default) and `Tabs` for the three snippets. Snippet text and the
public/private difference are moved verbatim from `visibility/Provider.vue`.

## R10. Usage: seven days from the data already fetched

**Decision**: the 30-day response has one row per date and model, newest
first. A pure `usageDays(rows, today, 7)` groups by date, fills missing days
with zeros and returns oldest-first; the block draws it as plain bars with
values. "All 30 days" opens the existing `UsagePanel` (unchanged) in the
theme's `Sheet`.

"Today so far" shows calls and tokens; the response carries no cost for
today, so none is shown.

## R11. Advanced and Delete

**Decision**: debug mode joins the draft. Promote keeps its confirmation;
demote, which today runs at once with no question, gets the same kind of
confirmation (the spec asks for "the same warning"). Both act immediately
after it (FR-041).

The Edit page's delete dialog (backup download, optional wipe of stored
files) moves to `delete/Dialog.vue` and is used by the Delete block **and** by
the header menu's Delete, which today opens a plainer dialog with neither
option. One dialog, so the two entry points cannot drift.

## R12. Retiring the Edit page

**Decision**: `pages/agents/[id]/edit.vue` becomes a redirect to
`/agents/:id?tab=overview` (replace, so Back does not loop).
`edit/Provider.vue` and `debug/Provider.vue` are deleted. `item/Form.vue`
stays for creating an agent and loses its edit-only branches. The header
menu's "Edit" entry goes; "Settings" is where editing is.

## R13. Hooks for browser tests, and the CLEAN-224 suite

**Decision**: the `data-*` hooks that `specs/030-agent-request-limits/e2e`
reads keep their names on the new elements (list in
`contracts/overview-ui.md`). Three things cannot stay the same and the three
030 scripts are updated for them:

| 030 script assumes | New page | Change in the script |
|--------------------|----------|----------------------|
| `[data-visibility-save]` is visible as soon as the card opens | the save bar appears only when something changed | wait for `[data-limit-input]` instead; click the bar's Save (same hook name) |
| origins are one text field to `.fill()` | chips | type the origin and press Enter |
| the operator's link leads to a visible Save button | — | assert the Request limit block is in view |

The anchor `#visibility-embed` keeps working (it now points at the Request
limit block) because the operator's chat line links to it.

## R14. Proving it

**Decision**: playwright-core scripts in
`specs/031-agent-overview-redesign/e2e/`, on the helpers, seed and fake agent
of `specs/030-agent-request-limits/e2e/` (extended, not copied): `nav.mjs`,
`summary.mjs`, `edit.mjs`, `limit.mjs`, `access.mjs`, `rest.mjs`, and
`all.mjs`, which runs these and then the 030 suite. The seed gains an LLM
credential, two knowledge bases and 30 days of usage rows for one agent.

The local stack has no pods, so pod load is exercised in its "not available"
state in the browser and in its normal state by unit tests on the mapping.

## R15. What does not change

No API route, DTO, migration or agent tool is added or changed: every field
is already accepted by `PUT /agents/:id`, and every figure already has a
route. Constitution V: no console capability is added or removed, so no tool
is owed. The app console is not touched.
