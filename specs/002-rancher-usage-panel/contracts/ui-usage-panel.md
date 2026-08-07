# UI Contract: <UsagePanel> and host layouts

**Feature**: 002-rancher-usage-panel · **Component**: `admin/slices/usage/components/usage/Panel.vue` (auto-imported as `<UsagePanel>`)

## Props

| Prop | Type | Required | Meaning |
|------|------|----------|---------|
| `agentId` | `string \| null` | yes | Scope of the "Agent" view. `null` ⇒ Agent tab disabled with hint (Rancher admin agent missing edge case). |
| `collapsible` | `boolean` | no (default `false`) | When true, panel can collapse to a compact button (agent chat tab side stack). |
| `title` | `string` | no | Header label; defaults to `Usage · 30d` (Rancher page passes `Rancher usage · 30d`). |

## Behavior (maps to spec FRs)

1. **Views** (FR-003): segmented control (theme `tabs`) — `Total` / `Calls` / `Agent`; active view visually indicated; switching resets pagination to page 1.
   - `Total`: all-agents 30d cost emphasized + totals, top model, per-agent breakdown, paginated daily rows. Source: `GET /usage/overview`.
   - `Calls`: same window with call volume emphasized (total calls + per-day calls). Source: `GET /usage/overview`.
   - `Agent`: this agent only — today snapshot (model, input/output tokens, calls) and 30d totals (cost, top model, input, output, calls) + paginated daily rows. Source: `GET /agents/:agentId/usage` (live today-merge preserved). Full field parity with the legacy `UsageCard` (FR-005).
2. **Pagination** (FR-004): client-side over the active view's `last30days`; page size 7; Prev/Next + "N–M of T" indicator; controls not rendered when T ≤ 7.
3. **Empty state** (FR-008): `totals.callCount === 0` ⇒ "No usage reported yet." — never bare zeros without context; fetch error ⇒ inline error, recoverable by refresh.
4. **Refresh** (FR-010): panel exposes a `refresh()` method (or reacts to store refetch) so the host page's existing refresh button updates the active view.
5. **Formatting**: `Intl.NumberFormat` for counts; USD with up to 4 fraction digits for sub-cent costs; large values never rendered raw.

## Host layout contracts

### Rancher page — `rancher/components/rancher/Provider.vue` (FR-001, FR-002, FR-009)

- Post-setup state: count tiles (Agents/Templates/Skills/LLMs/Knowledges) and their data fetching are **removed**; the chat (`BridleProvider`) is the central column; `<UsagePanel :agent-id="admin.id" title="Rancher usage · 30d" />` sits in a right-hand column; below `lg` the panel stacks under the chat (spec edge case "narrow screens").
- Pre-setup state: wizard flow byte-for-byte unchanged; no panel is rendered before the admin agent exists.
- Exactly **one** metrics block on the page (SC-005).

### Agent chat tab — `agent/.../chat/Tab.vue` (FR-006, FR-007)

- Right side becomes a vertical stack: `AgentLogsPanel` (top, existing collapse behavior) + `<UsagePanel :agent-id="agent.id" collapsible />` (bottom).
- Each collapses independently to a compact button (existing "Logs" button pattern); collapsing one gives the other the freed height; chat sizing/centrality unchanged.
- Both collapsed ⇒ chat keeps center, two compact buttons remain reachable (SC-006: chat and logs never permanently hidden).

### Agent overview tab — `agent/.../overview/UsageCard.vue`

- Replaces its bespoke `<dl>` body by rendering `<UsagePanel :agent-id="agentId" />` (non-collapsible, full-width card) so both surfaces share one implementation and cannot drift (FR-005/FR-006 parity, SC-003).

## Non-goals

- No custom date ranges (30d fixed), no CSV export, no per-model filtering, no localization beyond existing hardcoded-English convention (research R9).
