# Contract: Skills REST API (CLEAN-205)

Base: `/skills`, tag `skills`, JWT as today. Responses are the standard envelope the admin unwraps with `unwrapEnvelope`. Generated SDK names follow NestJS `operationId` conventions (`skillController<Method>`) unless `operationId` is set.

## Changed responses

### `SkillDto` (GET /skills, GET /skills/:id, POST, PUT, imports)

```jsonc
{
  "id": "skill-…",
  "name": "mazda-year-resolution",
  "title": "Mazda Year Resolution",
  "description": "…",
  "body": "# …",
  "files": [{ "path": "references/x.md", "content": "…" }],
  "filesCount": 1,                       // new
  "source": null,
  "group": "spec-lookup",                // new: enum SKILL_GROUPS | null
  "sortOrder": 10,                       // new
  "tokenEstimate": 1700,                 // new: ceil(body.length / 4)
  "templates": [{ "id": "tpl-…", "name": "Product Advisor" }],  // new, read-only
  "createdAt": "2026-10-08T09:12:00.000Z",
  "updatedAt": "2026-10-30T14:12:00.000Z"
}
```

`GET /skills` is ordered by `sortOrder asc, name asc`.

### `CreateSkillDto` / `UpdateSkillDto`

Add `group?: 'api' | 'routing' | 'spec-lookup' | 'answer-format' | 'runtime' | null` (`@IsOptional() @IsIn(SKILL_GROUPS)`; `null` clears). `UpdateSkillDto` stays `PartialType(CreateSkillDto)`, so `name` may be changed on edit (folder rename takes effect on the next redeploy, as today).

`POST /skills` and `PUT /skills/:id` with a taken `name` → `409 { statusCode: 409, code: 'SKILL_EXISTS', message, existing: { id, name, title } }`.

## New endpoints

All three are declared **before** `GET :id` in the controller (NestJS matches in declaration order, like `sources` and `search`).

### `GET /skills/order` — `operationId: getSkillOrder`

```jsonc
{ "version": "3f9a…", "items": [{ "id": "skill-…", "sortOrder": 1 }, …] }
```

`version` = sha1 over `items` sorted by id as `id:sortOrder` lines.

### `PATCH /skills/order` — `operationId: saveSkillOrder`

Request `SaveSkillOrderDto`:

```jsonc
{ "version": "3f9a…", "items": [{ "id": "skill-…", "sortOrder": 1 }, …] }
```

- `items` must list every skill exactly once with distinct `sortOrder` → otherwise `400`.
- `version` must equal the current one, checked under row lock in the same transaction → otherwise `409 { code: 'ORDER_CHANGED', message: 'The library order changed since you loaded it.' }`.
- Writes with one `UPDATE … FROM unnest(...)`; `updatedAt` untouched.
- Response: the new `{ version, items }`.

### `GET /skills/name-available?name=<slug>&excludeId=<id>` — `operationId: skillNameAvailable`

```jsonc
{ "name": "devops", "available": false, "existingId": "skill-…" }
```

`name` must match the slug rule (`400` otherwise). `excludeId` lets Edit keep its own name.

## Unchanged

`GET /skills/sources`, `GET /skills/search`, `POST /skills/import`, `POST /skills/import-url` (they now also assign `sortOrder = max + 1` and `tokenEstimate`), `GET /skills/:id/agents`, `DELETE /skills/:id`.

## Regeneration

After DTO changes: `cd api && bun run generate && bun run build && bun run generate:swagger`, then `cd admin && bun run build:api`. The admin `nuxt typecheck` regenerates both consoles' SDKs; if `app/slices/setup/api` changes and `app` needs nothing, restore it with `git show HEAD:<path> > <path>` before committing.
