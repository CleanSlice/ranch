# Contract: the agent Settings page (admin)

What the browser tests hold on to: structure, states and `data-*` hooks.
Behaviour is in spec.md; the look is the prototype
(`agent-overview-redesign.html`). Hooks marked **kept** already exist and are
read by `specs/030-agent-request-limits/e2e`.

## Section list

`nav[data-section-nav]`, `role="tablist"`, `aria-orientation` vertical on
desktop and horizontal in the one-row layout.

| Hook | On | Value |
|------|----|-------|
| `data-section-group="configure\|data\|observe"` | each group heading | — (absent in the one-row layout) |
| `data-section="<value>"` | each row (`role="tab"`) | the `?tab=` value: `overview`, `knowledge`, `a2a`, `channels`, `secrets`, `env`, `files`, `chats`, `logs`, `events`, `paddock` |
| `aria-selected`, `aria-current="page"` | the selected row | — |
| `data-section-count` | the count inside a row | the number; the element is absent when the count is unknown |

Order in the DOM is the order of the table above. A row is one line, at most
36 px high; the list is at most 200 px wide on desktop.

## Overview

`[data-overview]` wraps, in this order:

| Block | Root hook |
|-------|-----------|
| Summary strip | `data-summary` |
| Configuration | `data-block="config"` |
| Request limit | `data-block="limit"`, `id="visibility-embed"` (kept anchor) |
| Access | `data-block="access"` |
| Usage | `data-block="usage"` |
| Advanced | `data-block="advanced"` |
| Delete agent | `data-block="danger"` |
| Save bar | `data-save-bar` |

### Summary strip

Four cells, `data-summary-cell="status|spend|pod|requests"`; each has
`data-state="ok|unavailable"`. In `requests`: `data-used`, `data-limit`
(empty when there is no per-minute limit).

### Configuration

| Hook | Element |
|------|---------|
| `data-field="name\|description\|llm\|knowledge\|cpu\|memory"` | the control of each row |
| `data-changed` | present on a control whose value differs from the saved one |
| `data-knowledge-mode="template\|own"` | the two-way choice; `aria-pressed` on its buttons |
| `data-knowledge-option="<id>"` | each base in the list (only in `own`) |
| `data-field-error="<field>"` | the refusal text of a field |

### Request limit

| Hook | Element | |
|------|---------|--|
| `data-limit-switch` | the on/off switch, `role="switch"`, `aria-checked` | new |
| `data-limit-input="minute\|hour\|day"` | the three fields | **kept** |
| `data-limit-preset="10\|30\|60\|120"` | preset shortcuts, `aria-pressed` | new |
| `data-limit-peak="minute\|hour\|day"` | busiest value seen in 30 days | **kept** |
| `data-limits-error`, `data-limits-error-code` | refusal text by its field | **kept** |
| `data-limits-needed` | the ask for limits on a legacy public agent | **kept** |
| `data-limits-uncovered` | who is not counted, what is not covered | **kept** |
| `data-limit-preview` | "what the person sees" sample | new |
| `data-limit-verdict`, `data-over`, `data-refused` | the sentence about the last hour, with its two numbers | new |
| `data-load-view`, `data-load-window`, `data-used`, `data-limit`, `data-load-room`, `data-load-inflight`, `data-load-refused`, `data-load-exempt`, `data-load-partial` | live meters | **kept** |
| `data-load-chart`, `data-minute`, `data-accepted`, `data-refused`, `data-load-chart-limit` | last-hour chart | **kept** |
| `data-over` on a `[data-minute]` bar | the minute exceeds the typed limit | new |
| `data-limit-above-scale` on `[data-load-chart-limit]` | the limit is above what the chart shows | new |

### Access

| Hook | Element | |
|------|---------|--|
| `data-visibility-public` | the landing-page switch | **kept** |
| `data-visibility-saved="public\|private"` | what is saved right now | **kept** |
| `data-origins` | the chip input's root | new |
| `data-origin="<origin>"` | each chip; its remove button has `aria-label="Remove <origin>"` | new |
| `data-origin-input` | the text field inside it | new (replaces `data-visibility-origins`) |
| `data-origin-hint` | the line under it | new |
| `data-limits-share-warning` | private + active share link + no limits | **kept** |
| `data-embed` | the folded embed block; `data-state="open\|closed"` | new |
| `data-embed-kind="bubble\|inline\|token"` | the three choices | new |
| `data-embed-code`, `data-embed-copy` | the snippet and its Copy | new |

### Usage, Advanced, Delete

| Hook | Element |
|------|---------|
| `data-usage-kpi="cost\|calls\|input\|output"` | the four figures |
| `data-usage-day="YYYY-MM-DD"`, `data-value` | each of the seven bars |
| `data-usage-empty` | shown instead of the chart when there is no usage |
| `data-usage-all` | "All 30 days" |
| `data-advanced` | the folded block, `data-state="open\|closed"` |
| `data-field="debug"` | the debug switch |
| `data-admin-action="promote\|demote"` | the admin tools button |
| `data-agent-id-text` | the identifier |
| `data-delete-agent` | the delete button |
| `data-delete-dialog`, `data-delete-download`, `data-delete-wipe`, `data-delete-confirm` | the confirmation |

### Save bar

| Hook | Element | |
|------|---------|--|
| `data-save-bar` | the bar; absent from the DOM when nothing is changed | new |
| `data-save-count` | the number of unsaved changes | new |
| `data-save-restart-note` | present when CPU or memory changed | new |
| `data-visibility-save` | the Save button (name kept so the CLEAN-224 scripts still find it) | **kept** |
| `data-save-restart` | "Save and restart", only with the note | new |
| `data-save-discard` | Discard | new |

`role="status"` on the bar; it stays above the bottom edge while the page
scrolls and above the on-screen keyboard on a phone.

## Leaving with unsaved changes

The confirmation is the console's existing confirm dialog,
`data-confirm-dialog`, with `data-confirm-accept` and `data-confirm-cancel`.
It appears before: another section, the Chat tab, another agent, another
page. Closing the tab uses the browser's own prompt.

## Gone

`/agents/:id/edit` redirects to `/agents/:id?tab=overview`.
`data-visibility-origins` and the always-open snippets no longer exist.
