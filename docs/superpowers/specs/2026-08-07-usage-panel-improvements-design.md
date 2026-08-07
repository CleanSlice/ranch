# Usage Panel improvements — design

**Date:** 2026-08-07
**Status:** approved (user confirmed both choices interactively)

## Problem

The shared `UsagePanel` (`admin/slices/usage/components/usage/Panel.vue`) is rendered
in three places:

1. Agent chat side stack — `admin/slices/agent/agent/components/agent/chat/Tab.vue`
2. Agent Overview tab — `admin/slices/agent/agent/components/agent/overview/UsageCard.vue`
3. Rancher page — `admin/slices/rancher/components/rancher/Provider.vue`

Two issues:

- On agent surfaces (1, 2) the Total / Calls / Agent tabs are noise: the user is
  already in a single agent's context and only the Agent view is relevant.
- On the Rancher page the Total view's **By agent** list renders every agent with
  recorded usage; with many agents it stretches the card vertically.

## Decisions

- **Agent surfaces:** new boolean prop `agentOnly` on `Panel.vue`. When set, the
  tab strip is not rendered, the view is fixed to `agent`, and the workspace
  overview request is never issued (`immediate: false` on its `useAsyncData`, and
  `refresh()` only refreshes the agent source). Header hint "· this agent only"
  stays. Enabled at call sites (1) and (2). Rancher keeps all three tabs.
- **By agent overflow (Rancher):** sort entries by `costUsd` descending
  (server order is not guaranteed; the mapper passes it through), show the top 5,
  and when more exist render a ghost "Show all (N)" / "Show less" toggle below the
  list. Expansion state is local component state (collapsed again after reload).

## Scope

Only `Panel.vue` plus one-line prop additions at the two agent call sites. No
store, domain, mapper, or API changes. No visual restyle beyond the above.

## Testing

The admin workspace has no test or lint infrastructure (`admin test: no tests
yet`); verification is manual via the running app on the agent page and the
Rancher page.
