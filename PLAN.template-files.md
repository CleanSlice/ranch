# PLAN: template files (S3 + folder upload + editor)

> Phase 1 approved by user. This is the detailed plan.

## Goal
On `/templates`, when creating/editing a template, allow:
- uploading a folder (`.agent/...`) — saved to S3 under `templates/{templateId}/...`
- browsing/editing `.md` and `.json` files like the existing `agent/file` UX
- metadata stays in DB (`Template` model), `updatedAt` is bumped on every file change.

## Defaults (from approved Phase 1 q&a)
- Upload: browser folder picker (`<input webkitdirectory>` → multipart)
- Replace mode on full upload (wipe `templates/{id}/` before writing)
- Editable extensions: `.md`, `.json` only
- Per-file size limit: 256 KB
- Agent → template content copy on agent create: out of scope here

## API changes

### `agent/template` (extend)
- `domain/template.gateway.ts`: add `abstract touch(id: string): Promise<ITemplateData>`
- `data/template.gateway.ts`: implement `touch` (`prisma.template.update({ where:{id}, data:{ updatedAt: new Date() } })`); on `delete`, also wipe S3 prefix `templates/{id}/`
- `template.module.ts`: import `SettingModule` (needed for S3 settings during delete cleanup)

### `agent/templateFile` (NEW sub-slice)
Files:
```
api/src/slices/agent/templateFile/
├── templateFile.module.ts
├── templateFile.controller.ts
├── domain/
│   ├── index.ts
│   ├── templateFile.types.ts          # ITemplateFileNode, ITemplateFileContent
│   └── templateFile.gateway.ts        # abstract ITemplateFileGateway
├── data/
│   └── templateFile.gateway.ts        # S3TemplateFileGateway (mirrors S3FileGateway, prefix templates/{id}/, has uploadMany + wipe)
└── dtos/
    ├── index.ts
    ├── templateFileNode.dto.ts
    ├── templateFileContent.dto.ts
    └── saveTemplateFile.dto.ts
```

### Endpoints
| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/templates/:id/files` | List files under `templates/:id/` |
| `GET`  | `/templates/:id/files/content?path=…` | Read file |
| `PUT`  | `/templates/:id/files/content?path=…` | Save file (`.md`/`.json` only) — also touches DB updatedAt |
| `POST` | `/templates/:id/files/upload` | multipart, replace mode — wipes prefix, writes new files preserving relative paths; touches DB updatedAt |

### `app.module.ts`
Register `TemplateFileModule` after `TemplateModule`.

## App changes (`app/slices/template`)

### Store (`stores/template.ts`)
Replace stub with real Pinia store mirroring `useAgentStore`:
- `fetchAll`, `fetchById`, `create`, `update`, `remove`
- File ops: `listFiles`, `readFile`, `saveFile`, `uploadFolder` (FormData)

### Pages
- `pages/templates.vue` (existing) — keep, calls `TemplateListProvider`
- `pages/templates/create.vue` — new, hosts `TemplateProvider` in create mode
- `pages/templates/[id].vue` — new, hosts `TemplateProvider` for edit + files

### Components
- `components/templateList/Provider.vue` — list with "Create" link
- `components/templateList/Thumb.vue` — single card
- `components/template/Provider.vue` — orchestrates Form + Files (or just Form on create)
- `components/template/Form.vue` — name/description/image/defaults metadata form
- `components/template/Files.vue` — folder upload + tree + content editor (mirrors agent/file UX)

## DB
No schema migration. `Template.updatedAt` already exists (`@updatedAt`); we explicitly write to it on file ops via `touch()`.

## SDK regen
`predev`/`prebuild` hooks already run `openapi-ts` automatically — no manual step.

## Out of scope
- Auth on `/templates/*` endpoints (matches agent/file — same posture)
- Copying template files into agent's S3 prefix on agent create
- ZIP upload
- Binary file editing
