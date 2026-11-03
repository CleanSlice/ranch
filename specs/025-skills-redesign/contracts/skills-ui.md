# Contract: Skills admin UI (CLEAN-205)

What the pages promise to the URL, to assistive technology and to the e2e scripts. Implementation details stay in the plan and tasks.

## Routes (unchanged)

| Route | Page |
|---|---|
| `/skills` | library |
| `/skills/create` | New skill |
| `/skills/:id/edit` | Edit skill |
| `/skills/import`, `/skills/import/search`, `/skills/import/url` | unchanged |
| `/templates/:id` | target of "Used in templates" chips |

## URL state on `/skills`

| Param | Values | Written with | Default (omitted) |
|---|---|---|---|
| `q` | free text | `replace` | empty |
| `group` | `api` `routing` `spec-lookup` `answer-format` `runtime` `none` (ungrouped) | `replace` | all |
| `sort` | `custom` `recent` | `replace` | `custom` |
| `skill` | slug | `push` on selection | none; on desktop the panel then shows the first visible skill |

Back pops `skill` first (closes drawer / sheet, resets the desktop panel), then leaves the page; leaving with a pending order asks for confirmation.

## Breakpoints

| Width | Layout |
|---|---|
| ≥ 1280 (`xl`) | list + sticky 380 px panel column; always populated |
| 768–1279 (`md`…`xl`) | list full width; panel is a right drawer `min(420px, 90vw)` |
| < 768 | cards; panel is a bottom sheet 90 vh with a grab handle; 2×2 summary; chips scroll; sort is a `<select>`; Reorder mode |

Reduced motion: no slide / fade on drawer, sheet, or dragged row.

## Data hooks for e2e (stable attributes)

| Element | Attribute |
|---|---|
| list root | `data-skill-list` |
| row / card | `data-skill-row="<slug>"`, `aria-current="true"` when selected, `data-moved="↑2"` when displaced |
| drag handle | `data-skill-handle="<slug>"`, `button`, `aria-label="Reorder <slug>, position X of N. Use arrow keys to move."`, `disabled` under Recently edited |
| drop indicator | `data-skill-drop-indicator` |
| order bar | `data-skill-order-bar`, buttons `data-action="discard"` / `data-action="save-order"` |
| live region | `data-skill-live` with `aria-live="polite"` |
| strip segment | `data-skill-segment="<slug>"`, `button`, `aria-label="<slug>, 1.7k tokens"` |
| panel (any host) | `data-skill-panel`, with `data-host="column|drawer|sheet"` |
| copy path | `data-action="copy-path"` |
| inline delete | `data-skill-delete-confirm`, buttons `data-action="keep"` / `data-action="delete"` |
| mobile menu | `data-skill-menu="<slug>"` (44×44 button) |
| Reorder toggle (phone) | `data-action="reorder-mode"` |
| summary | `data-skill-summary` with `data-count`, `data-tokens`, `data-edited-week`, `data-unused` |
| states | `data-skill-state="loading|error|empty|no-match"` |

Form (`/skills/create`, `/skills/:id/edit`):

| Element | Attribute |
|---|---|
| title / slug / group / description / body | `id="title"`, `id="name"`, `id="group"`, `id="description"`, `id="body"` with `<label for>` |
| slug hint / error | `id="name-hint"`, referenced by `aria-describedby`; `aria-invalid="true"` on error |
| counters | `data-description-count`, `data-body-lines`, `data-body-tokens` |
| draft label | `data-skill-draft` |
| preview cards | `data-skill-preview="row"` / `"markdown"` |
| header actions | `data-action="cancel"` / `data-action="submit"` (disabled while invalid) |
| Write / Preview tabs (< 1024) | `role="tablist"` from the theme Tabs |

## Accessibility names and texts (exact strings)

- Reorder hint under Recently edited: `Reordering is off while sorted by edit time`
- Live announcement: `<slug> moved to position <x> of <n>`
- Order bar: `List order changed: <n> positions moved` (`1 position moved` for one)
- Copy path: `Copy path` → `Copied` for 2 s
- Empty panel: `Pick a skill to see its details`
- No match: `No skills match` + button `Clear search and filters`
- Inline delete: `Delete <slug>? It is removed from <A> and <B>.` / `Delete <slug>? It is not in any template.` with `Keep` / `Delete`
- Templates on a row: `<name>` | `<n> templates` (tooltip lists them) | `Not in any template`
- Edit time: `Edited <relative>` inside `<time datetime="<iso>" title="<absolute>">`; green dot when < 24 h
- New skill templates note: `A new skill is not in any template. Attach it on the Templates page after you create it.`
- Draft label: `Draft · edited <relative>`
- Slug hint: `Folder: .agent/skills/<slug>/`; slug errors: `Name is required` / `Use lowercase letters, digits and dashes` / `This name is taken`; Edit rename warning: `Renaming moves the folder to .agent/skills/<slug>/ in every agent on the next redeploy.`
- Description over budget: counter red + `The list cuts descriptions after 140 characters.`
- Toasts: order saved `Order saved`; order failed `Could not save the order` (list rolled back); 409 `Someone else changed the order. The list was reloaded.`; skill created `Skill <slug> created`.

Only `button`, `a`, `input`, `select`, `textarea`, `label` as interactive elements; icon-only buttons carry `aria-label`; focus ring from the theme's `focus-visible:ring-2`.
