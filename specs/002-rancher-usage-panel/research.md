# Research: Rancher & Agent Usage Panel Redesign

**Feature**: 002-rancher-usage-panel · **Date**: 2026-08-03

No NEEDS CLARIFICATION markers remained in the Technical Context; the research below records the decisions for each open design question, grounded in the current codebase.

## R1 — Source of the "total cost across all agents" aggregate

**Decision**: Add `GET /usage/overview` to `api/src/slices/usage/usage.controller.ts`, backed by a new `findRecentAll(days)` gateway method (`prisma.usage.findMany({ where: { date: { gte: since } } })`). Roll up rows at `date|model` grain for `last30days`, compute `totals`, `topModel`, and a `byAgent` breakdown (agent name resolved with fallback to raw ID) — exactly the shape and algorithm of the existing `GET /llms/:id/usage` (`findForCredential`), minus the credential filter.

**Rationale**: The aggregation, cost computation (`costUsd(model, in, out)` from `model-pricing`), sorting, and name-resolution logic already exist and are proven in `findForCredential` (usage.controller.ts:204-318). Reusing the response shape (`ICredentialUsageResponse` → new `IOverviewUsageResponse`) means the admin mapper pattern also transfers directly. One indexed query over ≤30 days of rows; no schema change.

**Alternatives considered**:
- *Client-side aggregation* — admin fetches every agent's usage and sums. Rejected: N requests per page view, duplicated cost logic, no single source of truth.
- *Database view / materialized rollup* — rejected: premature for tens of agents × 30 days; a plain query suffices.
- *Extending `GET /agents/:agentId/usage` with a query flag* — rejected: muddles a per-agent contract with a global one; separate endpoint is clearer in the generated SDK.

## R2 — Today's live snapshot in the aggregate view

**Decision**: The overview endpoint reads the **database only** — it does not merge each agent's live `data/usage.json` S3 snapshot the way the per-agent endpoint does.

**Rationale**: The per-agent live merge exists because a single agent's today row would otherwise be empty until the 23:50 UTC report (usage.controller.ts:71-76). Doing that for the overview means one S3 read per agent per panel load, growing linearly with fleet size, for a number that self-corrects at the daily report. The "this agent" view — where today-freshness actually matters to the admin watching one agent — continues to use the live-merged per-agent endpoint.

**Accepted limitation** (documented in the contract): the total view may understate the *current* day until agents report; per-agent view remains live.

**Alternatives considered**: parallel S3 reads for running agents only — deferred; can be layered in later without contract change (values only get fresher).

## R3 — What pagination applies to

**Decision**: Client-side pagination over the `last30days` array (entries at `date|model` grain, newest first), page size 7, Prev/Next buttons plus a "N–M of T" position indicator. Controls hidden when everything fits one page (spec FR-004).

**Rationale**: The window is bounded — 30 days × few models ⇒ tens of rows, always fully returned by the existing endpoints. Server-side pagination would add contract surface for no payload savings. Client-side also makes the page reset trivial when the user switches views. Existing admin slices (`chat/list`, `agent/file`) already paginate client-side; no shared pagination component exists in `#theme/components/ui` (no `pagination` dir), so simple Prev/Next buttons follow the repo's current convention.

**Alternatives considered**: server-side `?page=` params — rejected (bounded dataset); infinite scroll — rejected (panel is a compact side block; discrete pages match "установить пагинацию").

## R4 — Shared panel component placement & reuse

**Decision**: New `admin/slices/usage/components/usage/Panel.vue`, auto-registered by the Nuxt layer as `<UsagePanel>`. Consumed by: `rancher/components/rancher/Provider.vue` (right of chat), `agent/.../chat/Tab.vue` (side stack with logs), and `agent/.../overview/UsageCard.vue` (delegates to the panel so the Overview tab keeps field parity with one implementation).

**Rationale**: The `usage` slice owns the domain and already follows the layered pattern (domain/data/stores) — the component belongs with its data. Nuxt layers auto-scan each layer's `components/` directory (the `rancher` slice's `components/rancher/Provider.vue` is consumed as `<RancherProvider>` the same way); the usage slice currently has no `components/` dir, so adding one is additive. Props: `agentId` (scope for the "this agent" view; on the Rancher page this is the admin agent's id) and optional layout hints (e.g. `collapsible`).

**Alternatives considered**: duplicating a panel per slice — rejected (guaranteed drift, violates FR-006 parity); placing it in the `setup`/theme layer — rejected (it is domain UI, not a primitive).

## R5 — View switcher UI

**Decision**: Use the existing `#theme/components/ui/tabs` component as a compact segmented control inside the panel header with three values: **Total** (all-agents cost), **Calls** (call volume), **Agent** (this-agent cost). Active view visually indicated by the tabs primitive (FR-003).

**Rationale**: `tabs` exists in the theme (`admin/slices/setup/theme/components/ui/tabs`); no toggle-group primitive is present. Tabs give the required "active view" affordance without adding a dependency.

**Alternatives considered**: `select` dropdown — rejected (hides the available views; toggling is the primary interaction); adding a shadcn toggle-group — rejected (new primitive for no gain).

## R6 — Rancher page layout

**Decision**: In `rancher/components/rancher/Provider.vue` (post-setup state): delete the five count tiles (`stats` computed + its grid) and the wizard-column split; render the chat (`BridleProvider`) as the central column (keep existing sticky/height treatment) with `<UsagePanel :agent-id="admin.id">` in a right-hand column (~`w-96`-class width); the panel column stacks below the chat under `lg`. The incomplete-setup wizard branch is untouched (FR-009), and the wizard keeps its current position while setup is in progress.

**Rationale**: Matches the explicit requirement "ранчер по центру экрана, блок со стоимостью — справа". The dashboard/refresh plumbing for the removed tiles (`fetchAll` of templates/skills/llms/knowledges in `rancher-dashboard` asyncData) is deleted with them — the page stops fetching data it no longer shows.

## R7 — Agent page layout (delegated to design by the requester)

**Decision**: In `agent/.../chat/Tab.vue`, the right side (currently only `AgentLogsPanel`, `basis-1/2`) becomes a vertical stack: **logs on top, usage panel below**, each independently collapsible. Collapsed states mirror the existing logs pattern (collapse → compact button, like the current "Logs" button at chat/Tab.vue). Chat keeps its central/primary position and current sizing. On the Overview tab, `UsageCard.vue` renders the same `<UsagePanel>` so both surfaces stay in parity.

**Rationale**: Preserves the established logs UX (open by default, collapsible, polling stops when unmounted) while satisfying FR-007: chat central, logs reachable, usage visible. Stacking beats a third column (three columns starve the chat at 1440px) and beats tabs-within-the-side-area (hides logs during incidents).

**Alternatives considered**: third column — rejected (width); usage above logs — rejected (logs are the operational surface users watch live; usage is glanceable); panel only on Overview tab — rejected (user asked for it "в каждом агенте, в которого мы заходим" — the landing tab is Chat).

## R8 — SDK regeneration workflow

**Decision**: After the API endpoint lands, regenerate the admin SDK with `cd admin && bun run build:api` (runs `openapi-ts` against the API's swagger; `predev` does the same via `wait-for-swagger.mjs`). The admin data layer calls the newly generated `usageControllerFindOverview` operation; the mapper reads the response defensively (`unknown` → domain), consistent with `UsageMapper`.

**Rationale**: `*.gen.ts` files are generated artifacts (hey-api); the existing usage operations (`usageControllerFindForAgent`) arrived the same way. Defensive mapping means loose swagger typing cannot break the UI.

## R9 — Labels, formatting, i18n

**Decision**: Hardcoded English labels inside the panel ("Usage · 30d", "Cost", "Calls", "Tokens", "Top model", "No usage reported yet"), `Intl.NumberFormat` for counts and USD (4 fraction digits for sub-cent costs), matching the current tile (rancher Provider.vue:128-141) and `UsageCard.vue` formatting helpers.

**Rationale**: Every existing usage surface is hardcoded English; the rancher i18n file covers only title/subtitle. Localizing one component while its siblings are hardcoded adds inconsistency, not value. Large numbers/sub-cent costs formatting is already solved by the existing helpers (edge case in spec).

## R10 — Testing strategy

**Decision**: API — Jest unit test for the overview aggregation (controller or extracted roll-up helper): multi-agent rows aggregate correctly, agents with zero usage don't break totals, deleted-agent name falls back to ID. Admin — no test harness exists (`admin test: no tests yet`); validation is manual via quickstart.md scenarios; pure-TS domain/data additions are covered by `tsc` type-checking (repo has no vue-tsc).

**Rationale**: Matches the repo's current testing reality; the only new *logic* (aggregation) lives on the API side where Jest exists. UI changes are layout/composition, verified against the quickstart checklist.
