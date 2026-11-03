# Contract: agent tools for the Skills library (CLEAN-205)

Per `docs/agent-tools.md`: every console capability has a tool in the slice, with topic / title / template, gated, `confirm` on destructive ones, no secrets, and a spec.

| Console capability | Tool | Where | Change |
|---|---|---|---|
| List with group, size, templates | `list_skills` | `rancher/rancher.tool.ts` | none — returns the gateway entity, which now carries the new fields |
| Set / clear a skill's group (form select) | `update_skill` | `rancher/rancher.tool.ts` | + `group: z.enum(SKILL_GROUPS).nullable().optional()` |
| Create with a group | `create_skill` | `skill/skill.tool.ts` | + optional `group` |
| Reorder the library | `reorder_skills` | `skill/skill.tool.ts` | **new** |
| Delete (inline confirm) | `delete_skill` | `skill/skill.tool.ts` | none (already `confirm`, names templates) |
| Slug availability | — | — | a read the model gets from `list_skills`; no tool |
| Local draft, Copy path, Ctrl+S | — | — | browser conveniences, not capabilities |

## `reorder_skills`

```ts
@Tool({
  name: 'reorder_skills',
  topic: ToolTopics.Skills,
  title: 'Reorder the skills library',
  template: 'Put the skills «names» first in the library',
  destructive: false,
  description:
    'Change the display order of the Skills page: the named skills move to the ' +
    'front in the order given, every other skill keeps its place after them. ' +
    'This is the library order only — it does not change which skills agents ' +
    'or templates receive. Returns the new order as name and position. ' +
    'Unknown names come back in `unknown`; call list_skills to see the slugs.',
  parameters: z.object({
    names: z.array(z.string()).min(1).describe('Skill slugs, first to last'),
  }),
})
```

- Audience: operator only (`SkillTool` already `isListedForRequest → callerIsOperator`; method calls `requireOperator`).
- Backing: `SkillOrderService.reorderByNames(names)` → reads `{ version, items }`, builds the full permutation, calls the same `save(version, items)` the controller uses. A concurrent console save surfaces as the service's 409; the tool returns `ok({ error: 'The order changed while reordering — try again' })`.
- Result: `{ order: [{ name, position }], unknown: string[] }`. No secrets involved.

## Spec coverage (`skill.tool.spec.ts`, `rancher.tool.spec.ts`)

- `reorder_skills` not listed / forbidden for a plain agent; listed for an operator.
- Happy path: names `['b']` over order `[a, b, c]` → service called with `[b, a, c]`; result positions 1..3.
- Unknown name reported, known ones still applied.
- Service 409 → result carries the error, nothing else thrown.
- `update_skill` with `group: 'routing'` passes it to `gateway.update`; with `group: null` clears it.
- `create_skill` with `group` passes it to `gateway.create`.
