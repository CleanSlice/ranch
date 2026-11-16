# Quickstart: proving the Overview redesign

Commands are from the repository root unless a `cd` says otherwise. Hooks
named here are in [contracts/overview-ui.md](./contracts/overview-ui.md).

## 1. Prerequisites

- Docker Desktop running; `cd api && docker compose up -d postgres-local &&
  npx prisma migrate deploy` (starting Postgres from a worktree repoints the
  shared `ranch-postgres` container at this checkout's data directory).
- `bun install` at the root; `cd api && bun run generate && bun run build`.
- `cd admin && npx nuxt prepare` and `cd app && npx nuxt prepare` in a fresh
  worktree.
- playwright-core as for the earlier features (`PLAYWRIGHT_DIR`, default
  `C:/Users/maxim/pw`).

## 2. Fast checks (no browser)

```bash
cd admin && bun test slices          # sections, agentDraft, limitPreview, parseOrigin, usageDays + existing
cd admin && npx nuxt typecheck
bun run locale:check                 # no Intl / toLocale* in components
```

Never Prettier or ESLint over `admin/`.

## 3. Bring the stack up for the browser

The runner in §4 starts the API and the fake agents itself, after seeding.
Start only the consoles:

```bash
cd admin && API_URL=http://localhost:3333 NUXT_PUBLIC_API_URL=http://localhost:3333 npx nuxt dev --port 3001
cd app   && API_URL=http://localhost:3333 NUXT_PUBLIC_API_URL=http://localhost:3333 npx nuxt dev --port 3000
```

Nothing may already listen on `:3333`.

## 4. Browser checks

```bash
node specs/031-agent-overview-redesign/e2e/all.mjs
```

It seeds (the CLEAN-224 fixtures plus an LLM credential, two knowledge bases
and 30 days of usage for `limits-off`), starts the API and the fake agents,
runs the scripts below, then runs the whole CLEAN-224 suite
(`specs/030-agent-request-limits/e2e`) on the same build. Exit code 0 only
when everything passed. Each script can be run alone against a stack that is
already up.

| Script | Proves |
|--------|--------|
| `nav.mjs` | eleven rows in the new order under three headings; one line each, list ≤ 200 px wide and fully visible at 1280×720 with no scroll; counts shown or absent, never a false zero; selected row has `aria-current`; every old `?tab=` value (and `peers`, `settings`) opens its section; keyboard reaches and opens a section; at 390 px the list is one sideways row with no headings and the page has no horizontal scroll |
| `summary.mjs` | four cells with figures matching the API for the same agent; pod load says "not available" for a pod-less agent and is not 0%; requests cell moves within 5 s of a burst; a stopped agent still shows spend and requests; two-by-two at 390 px |
| `edit.mjs` | no save bar until something changes; rename → field marked, "1 unsaved change"; change model and tick a knowledge base → count 3; set a field back → count drops; Discard restores all; Save writes all three and only those (request body asserted); reload shows them; CPU change → restart note and "Save and restart"; unsaved changes + another section, the Chat tab, another agent, another page → confirmation each time, Cancel keeps the edits; `/agents/:id/edit` lands on Overview |
| `limit.mjs` | limits off → switch off, chart without a line, sentence names the hour's peak; typing a per-minute value below the peak marks the over-limit minutes and the sentence gives minutes and requests, with nothing saved (no request sent); a value far above traffic keeps bars readable and says the limit is above the scale; a preset fills the field and counts as a change; hour < minute refused by its field; public agent + switch off → refused in this block; peaks, "not counted" line and the person's sentence present |
| `access.mjs` | origin typed + Enter becomes a chip; duplicate not added; a path or no scheme refused with the hint; chip removed by pointer and by keyboard; saved list survives reload; embed closed by default, three snippets one at a time, Copy puts the snippet on the clipboard; snippet has no token for a public agent and a placeholder for a private one; switch on with no limit → refused, pointing at Request limit; share warning on `limits-share` |
| `rest.mjs` | usage figures equal the API's; seven bars with values, zero days present; empty state for an agent with no usage; "All 30 days" opens the full panel; Advanced closed by default; debug switch counts as a change and saves; demote asks first; delete opens the dialog with backup and wipe options and Cancel leaves the agent; page has no horizontal scroll at 390, 768, 1024, 1280, 1440, 1920 px; nothing animates under reduced motion |

Screenshots land in `specs/031-agent-overview-redesign/e2e/shots/` (not
committed) and go on the ticket next to the prototype.

## 5. Manual look against the prototype

Open `agent-overview-redesign.html` beside
`http://localhost:3001/agents/<id>?tab=overview` at 1440×900 and compare block
by block: list width and row height, the strip, row layout of Configuration,
the limit chart and sentence, the folded blocks, the save bar. Differences
listed in spec.md ("Where the prototype and the product disagree") are
expected; anything else is a finding.
