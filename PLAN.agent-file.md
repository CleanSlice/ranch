# PLAN: agent/file slice (S3 file viewer + editor)

> Status: approved by user (high-level). This document is the detailed plan.

## Goal

Display the S3 contents of an agent's data bucket inside the admin "agent details"
page, with read + write for `.md` and `.json`, mobile-first. Files live at
`s3://ranch-agent-data-dreamvention/agents/{agentId}/...`.

Agent re-reads files on next restart — no live signal needed.

## Slices

| Slice | Type | Responsibility |
|---|---|---|
| `agent/file` (api + admin) | New subslice | S3 gateway + REST + UI for browsing/editing |
| `agent/agent` (admin) | Extend | Add "Files" section to the details page |

`setting` slice is reused as the source of AWS credentials (group `integrations`,
keys `aws_access_key_id`, `aws_secret_access_key`, `aws_region`, `s3_bucket`,
`s3_endpoint`). No new env vars required — same flow already used by
`AgentProvider` for the env-vars panel.

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/agents/:id/files` | List file tree under `agents/:id/` (flat list with size + mtime) |
| `GET`  | `/agents/:id/files/content?path=…` | Read file content (text) |
| `PUT`  | `/agents/:id/files/content?path=…` | Save content (`.md` / `.json` only; JSON validated) |

> Note: file path is a query param (not URL wildcard) — sidesteps NestJS 11 /
> Express 5 wildcard route changes and avoids needing custom path-encoding.

Auth follows existing `/agents/:id` (no guard currently — same here).

## API Files

```
ranch/api/src/slices/agent/file/
├── file.module.ts
├── file.controller.ts
├── domain/
│   ├── index.ts
│   ├── file.types.ts        # IFileNode, IFileContent, ISaveFileData
│   └── file.gateway.ts      # abstract IFileGateway
├── data/
│   └── file.gateway.ts      # concrete S3FileGateway (uses @aws-sdk/client-s3)
└── dtos/
    ├── index.ts
    ├── fileNode.dto.ts      # response: list item
    ├── fileContent.dto.ts   # response: read
    └── saveFile.dto.ts      # request: write body
```

### IFileGateway

```ts
abstract class IFileGateway {
  abstract list(agentId: string): Promise<IFileNode[]>;
  abstract read(agentId: string, path: string): Promise<IFileContent>;
  abstract save(agentId: string, path: string, content: string): Promise<void>;
}
```

### Constraints

- Path validation: reject `..`, leading `/`, null bytes
- Write whitelist: only `.md`, `.json`
- JSON `.json` payloads validated with `JSON.parse` before `PutObject`
- Soft size limits: read responses cap at 256 KB (skip/empty above), writes reject above 256 KB

## Admin Files

```
ranch/admin/slices/agent/file/
├── nuxt.config.ts                       # alias #agentFile, autoload stores
├── stores/
│   └── agentFile.ts                     # Pinia store, unwraps {success,data}
├── components/agentFile/
│   ├── Provider.vue                     # entry: takes :id, fetches list, mobile/desktop layout
│   ├── Tree.vue                         # left pane (folder/file list, click → select)
│   ├── Viewer.vue                       # right pane (header + Editor or empty state)
│   └── Editor.vue                       # textarea + Save button
└── i18n/locales/en.json
```

`Provider.vue` mobile rules:
- `< md`: only Viewer visible. A "Files" button in the header opens a `Sheet`
  containing the Tree. Selecting a file closes the sheet.
- `≥ md`: split view (`Tree` 280–320px + `Viewer` flexible) — same as the
  reference screenshot.

Editor:
- `<textarea class="font-mono">` (no Monaco — bad on mobile, heavy).
- Tracks dirty state, disables Save when clean, shows save error inline.

## Wiring

1. `ranch/api/src/app.module.ts` → import `FileModule` next to `LogModule`.
2. `ranch/api/package.json` → add `"@aws-sdk/client-s3": "^3"` to deps.
3. Run API once to regenerate `swagger-spec.json`, then `npm run build:api` in
   `ranch/admin/` to update the SDK (`AgentsService.agentFileController*` or a
   new `FilesService` depending on tag).
4. `ranch/admin/slices/agent/agent/components/agent/Provider.vue` → add a new
   `Card` titled "Files" between Environment and the right column (or under
   Logs on mobile), mounting `<AgentFileProvider :id="agent.id" />`.

## Out of scope (this iteration)

- Create / delete / rename
- Versioning / diff / history
- Binary file viewing (sqlite, images) — listed but not opened
- Live agent signal — restart picks up changes

## Verification

- API: `npm run start:dev` boots, `/api` swagger shows `Files` endpoints
- Admin: details page renders Files panel, list loads, opening `.md`/`.json`
  shows content, save round-trips
- Mobile: at < md, sheet opens, file selection closes sheet, editor takes full
  width
- Build: `npm run build` (api), `npm run build` (admin) — no errors
