# Contract: the agent list in the customer console

`app/slices/agent` — the rail on `/agents/:id`, in its column and in the
narrow-screen overlay. The API is not changed: `AgentDto.isAdmin` is already
in the response.

## Order

| Rule | |
|------|---|
| Agents flagged `isAdmin` | first |
| Everything else | the order the API returned (newest first), unchanged |
| Several flagged agents | all first, in the API's order among themselves |
| No flagged agent | the list as it is today |

The sort is stable and applied after the name search, so a search term that
does not match the admin agent hides it like any other entry.

## Mark

The pinned entry shows a shield icon after its name.

| Attribute | Value |
|-----------|-------|
| `title` and `aria-label` | `rail.admin_agent` |

`app/slices/agent/i18n/locales/en.json`, under `rail`:

| Key | English |
|-----|---------|
| `admin_agent` | Ranch admin agent |

## Not changed

- **Landing**: `/agents` still opens the remembered agent, then the first
  running one, then the first in the list (spec 006, FR-020). The "first in
  the list" fallback reads the unsorted list, as today.
- **Who sees the agent**: whoever `GET /agents` returns it to.
- **The admin console's rail**: already pins and marks; it is the reference.

## Specs owed

`app/slices/agent/utils/railOrder.test.ts`: flagged agent last in the input →
first in the output; relative order of the rest preserved; none flagged →
input order; two flagged → both first, in input order.
