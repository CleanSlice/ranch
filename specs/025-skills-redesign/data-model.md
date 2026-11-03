# Data model: Skills library redesign (CLEAN-205)

## Skill (Prisma, `api/src/slices/skill/skill.prisma`)

| Field | Type | Change | Notes |
|---|---|---|---|
| id | String @id | — | `skill-<uuid>` from the mapper |
| name | String @unique | — | slug `^[a-z0-9][a-z0-9-]*$`; unique violation → 409 `SKILL_EXISTS` (R13) |
| title | String | — | |
| description | String? | — | advisory 140-char budget in the UI only |
| body | String | — | SKILL.md |
| files | Json | — | `[{ path, content }]` |
| source | String? | — | import origin; drives the "Imported" activity entry |
| **group** | String? | **new** | one of `SKILL_GROUPS` or null; validated in DTOs |
| **sortOrder** | Int @default(0) | **new** | library display order, shared; indexed |
| **tokenEstimate** | Int @default(0) | **new** | `ceil(length(body)/4)`, written on every body write |
| templates | Template[] | — | implicit m:n; selected as `{ id, name }` in reads |
| createdAt | DateTime | — | |
| updatedAt | DateTime @updatedAt | — | must NOT move on an order-only save (raw SQL, R4) |

Indexes: existing `@@index([name])`, new `@@index([sortOrder])`.

### Migration `20261103120000_skill_library_order`

1. `ALTER TABLE "Skill" ADD COLUMN "group" TEXT, ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "tokenEstimate" INTEGER NOT NULL DEFAULT 0;`
2. `CREATE INDEX "Skill_sortOrder_idx" ON "Skill"("sortOrder");`
3. Backfill order: `UPDATE "Skill" s SET "sortOrder" = r.n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", name) AS n FROM "Skill") r WHERE r.id = s.id;` (1-based, by creation then name — spec assumption "initial order by creation date").
4. Backfill tokens: `UPDATE "Skill" SET "tokenEstimate" = CEIL(LENGTH(body) / 4.0);`

Additive and safe on a live database; no data removed.

## SKILL_GROUPS (config, both projects)

| key | label | colour role |
|---|---|---|
| `api` | API | blue |
| `routing` | Routing | violet |
| `spec-lookup` | Spec lookup | green |
| `answer-format` | Answer format | amber |
| `runtime` | Runtime | slate |
| *(null)* | Ungrouped | neutral (admin only; never stored) |

API: `api/src/slices/skill/domain/skill.groups.ts` exports `SKILL_GROUPS` (readonly tuple) and `SkillGroup`. Admin: `admin/slices/skill/domain/skill.groups.ts` exports `SKILL_GROUP_META satisfies Record<SkillGroup, { label; chip; mark; strip }>` where `SkillGroup` is the generated union from `#api/data/repositories/api/types.gen`.

## Library order (not a table)

`ISkillOrder = { version: string; items: { id: string; sortOrder: number }[] }`

- `version` = hex sha1 of `items` sorted by id, joined as `id:sortOrder` with `\n`. Computed by `SkillOrderService.version(items)`; same function on read and inside the save transaction.
- Invariants checked on save: `items` is a permutation of every skill id (no missing, no extra, no duplicate), `sortOrder` values are distinct. Violation → 400. Version mismatch → 409 `ORDER_CHANGED`.
- New skill: `sortOrder = max + 1` in the insert's transaction (create and both imports).
- Deleting a skill leaves a gap; gaps are fine (ordering is relative), the next save renumbers.

## API entity `ISkillData` (api domain) / `SkillDto`

Existing fields plus:

| Field | Type | Source |
|---|---|---|
| group | `SkillGroup \| null` | column |
| sortOrder | number | column |
| tokenEstimate | number | column |
| filesCount | number | mapper: `files.length` |
| templates | `{ id: string; name: string }[]` | include |

`ICreateSkillData` / `IUpdateSkillData` gain `group?: SkillGroup | null`. The gateway sets `tokenEstimate` whenever `body` is in the write.

## Admin domain `ISkillData` (`admin/slices/skill/domain/skill.types.ts`)

Mirror of the DTO with ISO strings for dates, plus:

- `ISkillInput` gains `group?: SkillGroup | null`.
- `ISkillOrder` as above.
- `ISkillOrderConflict = { code: 'ORDER_CHANGED' }` recognised by the gateway's error mapping so the store can tell 409 from other failures.

## Admin store `useSkillStore` (one record per skill)

State: `items: ISkillData[]`, `loading`, `error`, `order: { version: string | null; saved: string[]; draft: string[] | null }`.

| Action | Behaviour |
|---|---|
| `fetchAll()` | replaces `items`, then `fetchOrder()` (or reads `sortOrder` from items and asks `GET /skills/order` only for the version) |
| `fetchById(id)` | upserts |
| `byId(id)`, `byName(slug)` | lookups for computeds |
| `upsert(skill)` | replace or append |
| `patch(id, partial)` | returns a rollback that restores a field only if it still holds the optimistic value (agent store pattern) |
| `create`, `update`, `importFromGithub`, `importFromUrl` | upsert the returned record (already so) |
| `remove(id)` | deletes locally after the call; also drops the id from `order.saved` / `order.draft` |
| `beginReorder()` / `moveDraft(from, to, visibleIds)` | sets `order.draft` through `moveVisible`; `movedCount` and badges derive from `orderDiff(saved, draft)` |
| `discardOrder()` | `draft = null` |
| `saveOrder()` | PATCH with `version`; on success `saved = draft`, `draft = null`, write `sortOrder` into each item, new `version`; on 409 → `fetchAll()` and rethrow `ORDER_CHANGED`; on other errors → `draft = null` (rollback) and rethrow |
| `isNameAvailable(name, excludeId?)` | passthrough read |

Derived (computeds in the Provider, not the store): visible list = items ordered by `draft ?? saved` (custom) or by `updatedAt desc` (recent), filtered by `q` and `group`; summary numbers; strip segments.

## Form draft (browser only)

`localStorage['admin.skill.draft.<userId>.<slug|new>'] = { title, name, group, description, body, savedAt }`. Written through `useLocalStorage` with a 500 ms debounce; removed on successful create; never read on Edit.

## Activity (derived, admin)

`activityOf(skill) → { kind: 'created' | 'imported' | 'edited'; at: string }[]` — `imported` when `source` is set, `edited` only when `updatedAt − createdAt > 1 s`.
