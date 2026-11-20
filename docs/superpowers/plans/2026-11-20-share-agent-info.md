# Share Chat Agent Info Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A share-link visitor sees the agent's description in the header and an info button that opens a right-side panel with description, skills, limits, attachment rules, status and a privacy note.

**Architecture:** `POST /share/resolve` grows four allowlisted fields, built in `ShareLinkService.resolveForVisitor` from the agent's `config.description`, its template, the template's skills, `AgentLimitService.getLimits` and the attachment constants. The `app` share slice maps them into the one `resolved` object its store already holds and renders them in a new `SharePageInfo` sheet. No schema change.

**Tech Stack:** NestJS + jest (`api`), Nuxt 3 + Pinia + `bun test` (`app`, `admin`), `reka-ui` Sheet, vue-i18n via `bun run i18n:sync`.

**Spec:** `docs/superpowers/specs/2026-11-20-share-agent-info-design.md` — read it first.

## Global Constraints

- Jira `CLEAN-237`; branch `feat/CLEAN-237-share-agent-info`; every commit subject ends with `(CLEAN-237)`. Worktree: `/Users/maksymtmk/my-knowledge/ranch-CLEAN-237`.
- Fresh worktree: `bun install`, then `cd api && bun run generate && bun run build` before jest or swagger.
- The resolve response is built from an explicit allowlist. Never spread an agent, template, skill or limit record into it.
- Visitors never receive: usage, `retryAfter`, in-flight counts, `statusReason`, model, credentials, resources, MCP servers, peers, creator, dates, `allowedOrigins`, rotation count, skill ids/bodies/sources, knowledge bases.
- Invalid, revoked and unknown tokens keep answering the identical 404 `{ code: 'SHARE_LINK_NOT_FOUND' }`.
- Description shown to a visitor: `config.description` → template description → `null`; trimmed; at most 500 characters.
- `app` copy: `en.json` is the source, `ru.json` only via `bun run i18n:sync`; templates use `$t`; keys chosen in script travel as keys. Sizes and numbers go through `useFormat()`; no `Intl.*` or `toLocale*String` in components.
- The resolved share lives only in `useShareStore().resolved`.
- `reka-ui ^2.9.6` and `@vueuse/core ^14.3.0` in `app`, the versions `admin` uses.
- Before any push: `bun run typecheck`, `bun run locale:check`, `bun run test:scripts` from the repo root.
- Match the comment density of the files touched; several of them have comments stating "deliberately three fields" that become false and must be rewritten, not left.

## Review Focus

1. The template or skill lookup fails or the template is gone → resolve still answers 200 with `skills: []` and whatever description is left. A visitor's chat must not hang on decoration. (Task 1)
2. An API older or newer than the client → the app mapper reads a response with the new fields missing or malformed as "nothing to show", never as an unreadable link. (Task 3)
3. Description is whitespace, longer than 500 characters, or not a string → `null` / cut at 500. Rendered as plain text with line breaks kept; no `v-html`. (Tasks 1, 4)
4. A limit row with only one window set, or a row where every window is null → only the set windows are shown; all-null is `limits: null` and the section is absent. (Tasks 1, 4)
5. Forty skills, a skill with a blank title → the sheet body scrolls inside the viewport at phone width; blank-title skills are dropped on the server. (Tasks 1, 4)

---

### Task 1: API — resolve carries what the visitor may know

**Files:**
- Create: `api/src/slices/agent/shareLink/domain/shareAgentInfo.ts`
- Create: `api/src/slices/agent/shareLink/domain/shareAgentInfo.spec.ts`
- Modify: `api/src/slices/agent/shareLink/domain/shareLink.types.ts` (`IShareResolved`)
- Modify: `api/src/slices/agent/shareLink/domain/shareLink.service.ts` (`resolveForVisitor`, constructor)
- Modify: `api/src/slices/agent/shareLink/domain/shareLink.service.spec.ts`
- Modify: `api/src/slices/agent/shareLink/dtos/shareResolve.dto.ts`, `share.controller.ts`, `shareLink.module.ts`
- Modify: `api/src/slices/agent/limit/limitPrivacy.spec.ts`, `api/src/slices/agent/limit/agentLimit.prisma` (comment)
- Modify: `specs/010-share-agent-link/spec.md` (FR-014), `specs/030-agent-request-limits/spec.md` (FR-051)

**Interfaces:**
- Consumes: `ITemplateGateway.findById(id)` → `{ description, skillIds }`; `ISkillGateway.findByIds(ids)` → `ISkillData[]` (`title`, `description`); `AgentLimitService.getLimits(agentId): IAgentLimits | null`; `hasAnyLimit` from `#/agent/limit/domain/agentLimit.types`; constants from `#/bridle/domain/attachment.constants`.
- Produces (in `shareLink.types.ts`):

```ts
export const SHARE_DESCRIPTION_MAX = 500;
export type ShareAttachmentKind =
  | 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text';
export interface IShareSkill { title: string; description: string | null }
export interface IShareLimits {
  perMinute: number | null; perHour: number | null; perDay: number | null;
}
export interface IShareAttachments {
  maxPerMessage: number; maxFileBytes: number; maxMessageBytes: number;
  kinds: ShareAttachmentKind[];
}
export interface IShareResolved {
  agentId: string; agentName: string; agentStatus: string;
  description: string | null;
  skills: IShareSkill[];
  limits: IShareLimits | null;
  attachments: IShareAttachments;
}
```

- Produces (in `shareAgentInfo.ts`, pure, no Nest):

```ts
export function describeForVisitor(config: unknown, templateDescription: string | null | undefined): string | null;
export function skillsForVisitor(skills: { title: string; description: string | null }[]): IShareSkill[];
export function limitsForVisitor(limits: IAgentLimits | null): IShareLimits | null;
export function attachmentsForVisitor(): IShareAttachments;
```

- [ ] **Step 1: Write failing tests for the pure functions** in `shareAgentInfo.spec.ts`:

```ts
describe('describeForVisitor', () => {
  it('prefers the agent, falls back to the template, then to nothing', () => {
    expect(describeForVisitor({ description: ' Own ' }, 'Tpl')).toBe('Own');
    expect(describeForVisitor({ description: '   ' }, ' Tpl ')).toBe('Tpl');
    expect(describeForVisitor({ description: 42 }, '')).toBeNull();
    expect(describeForVisitor(null, undefined)).toBeNull();
  });
  it('cuts at 500 characters', () => {
    expect(describeForVisitor({ description: 'x'.repeat(600) }, null)).toHaveLength(500);
  });
});
describe('skillsForVisitor', () => {
  it('keeps title and description only and drops blank titles', () => {
    const out = skillsForVisitor([
      { id: 's1', title: ' Orders ', description: ' Tracks orders ', body: 'SECRET', source: 'https://x' },
      { id: 's2', title: '  ', description: 'x' },
      { id: 's3', title: 'FAQ', description: '  ' },
    ] as never);
    expect(out).toEqual([
      { title: 'Orders', description: 'Tracks orders' },
      { title: 'FAQ', description: null },
    ]);
  });
});
describe('limitsForVisitor', () => {
  it('is null without a row or with every window null', () => {
    expect(limitsForVisitor(null)).toBeNull();
    expect(limitsForVisitor({ perMinute: null, perHour: null, perDay: null })).toBeNull();
  });
  it('carries exactly the three configured values', () => {
    const src = { perMinute: null, perHour: 20, perDay: 100, updatedById: 'u1' };
    expect(limitsForVisitor(src as never)).toEqual({ perMinute: null, perHour: 20, perDay: 100 });
  });
});
describe('attachmentsForVisitor', () => {
  it('reports the server constants and every accepted family', () => {
    expect(attachmentsForVisitor()).toEqual({
      maxPerMessage: 5,
      maxFileBytes: 10 * 1024 * 1024,
      maxMessageBytes: 25 * 1024 * 1024,
      kinds: ['image', 'pdf', 'document', 'spreadsheet', 'presentation', 'text'],
    });
  });
  it('has a family for every accepted MIME type', () => {
    // kindOf is exported for this test: a MIME type added to ALLOWED_MIME_TYPES
    // without a family fails here instead of silently going unadvertised.
    for (const mime of ALLOWED_MIME_TYPES) expect(kindOf(mime)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run** `cd api && bun run test -- shareAgentInfo` — expected: FAIL, module not found.

- [ ] **Step 3: Add the types to `shareLink.types.ts` and implement `shareAgentInfo.ts`.** Also export `kindOf(mime: string): ShareAttachmentKind | null`: `image/*` → `image`; `application/pdf` → `pdf`; the two Word types → `document`; the three Excel types → `spreadsheet`; the two PowerPoint types → `presentation`; `TEXT_MIME_TYPES` → `text`. `attachmentsForVisitor().kinds` is the distinct `kindOf` of `ALLOWED_MIME_TYPES` in the order listed in the test. Values are read from the constants, not retyped.

- [ ] **Step 4: Run** the same command — expected: PASS.

- [ ] **Step 5: Write failing service tests** in `shareLink.service.spec.ts`. Extend `newService` so it also takes template, skill and limit stubs (defaults: template `null`, skills `[]`, `getLimits` → `null`) and replace `returns only the agent id, name and status` with:

```ts
it('returns exactly the allowlisted keys', async () => {
  // agent-1: templateId 't1', config { description: 'Own text', botToken: 'SECRET' }
  // template t1: { description: 'Tpl', skillIds: ['s1'] }; skill s1: title 'Orders', description 'Tracks orders'
  // limits: { perMinute: null, perHour: 20, perDay: 100 }
  const resolved = await service.resolveForVisitor(token!);
  expect(Object.keys(resolved).sort()).toEqual(
    ['agentId', 'agentName', 'agentStatus', 'attachments', 'description', 'limits', 'skills'],
  );
  expect(resolved.description).toBe('Own text');
  expect(resolved.skills).toEqual([{ title: 'Orders', description: 'Tracks orders' }]);
  expect(resolved.limits).toEqual({ perMinute: null, perHour: 20, perDay: 100 });
  expect(JSON.stringify(resolved)).not.toContain('SECRET');
});
it('still answers when the template or its skills cannot be read', async () => {
  // templates.findById rejects → description falls back to config only, skills []
  // skills.findByIds rejects   → skills []
});
it('answers limits: null for an agent without limits', async () => { /* getLimits → null */ });
```

Keep the three 404 tests unchanged; they must still pass untouched.

- [ ] **Step 6: Run** `cd api && bun run test -- shareLink.service` — expected: the new tests FAIL.

- [ ] **Step 7: Implement.** `ShareLinkService` constructor gains `ITemplateGateway`, `ISkillGateway`, `AgentLimitService`. `resolveForVisitor` keeps its link and agent checks first, then reads template and skills inside a `try` that degrades to "no template, no skills" on any error, and returns an object literal naming the seven keys. `ShareResolvedDto` gains the four properties with nested DTO classes (`ShareSkillDto`, `ShareLimitsDto`, `ShareAttachmentsDto`) and `@ApiProperty` on every field (`nullable: true` where the type is); `ShareController.resolve` copies the seven keys explicitly. `ShareLinkModule` imports `TemplateModule`, `SkillModule` and `AgentLimitModule`; if Nest reports a circular import at boot, wrap the offender in `forwardRef` the way this module already does for `AgentModule`. Rewrite the "deliberately slim / three fields" comments and the `resolveShareLink` operation summary to describe the allowlist.

- [ ] **Step 8: Extend `limitPrivacy.spec.ts`** with one test: the share DTO is the one anonymous surface that names limits, and only values.

```ts
it('lets a share visitor read the configured values and nothing else', () => {
  const text = source('shareLink/dtos/shareResolve.dto.ts');
  for (const word of ['perMinute', 'perHour', 'perDay']) expect(text).toContain(word);
  for (const word of ['atLimit', 'needsLimits', 'retryAfter', 'AgentLoad', 'used', 'inFlight']) {
    expect(text).not.toContain(word);
  }
});
```

Update the file's header comment and the `agentLimit.prisma` comment to name the exception.

- [ ] **Step 9: Revise the specs.** `specs/010-share-agent-link/spec.md` FR-014: a token grants chatting plus the visitor-facing agent summary listed in the design's "What the visitor is told" table, and nothing else. `specs/030-agent-request-limits/spec.md` FR-051: configured values may reach a share visitor through `/share/resolve`; usage, waits beyond the existing notice and head-count reach no anonymous caller. Leave "The notice in the chat" as is. Check `CLAUDE.md` and `.specify/memory/constitution.md` for a sentence this makes wrong; fix both if one is.

- [ ] **Step 10: Run** `cd api && bun run test -- shareLink limitPrivacy shareAgentInfo && npx tsc --noEmit && bun run build && bun run generate:swagger` — expected: all PASS, the build boots the module graph without a circular-dependency error, `api/swagger-spec.json` lists the new `ShareResolvedDto` properties.

- [ ] **Step 11: Commit** — `feat(share): resolve tells the visitor what the agent is for and what it accepts (CLEAN-237)`

---

### Task 2: Description reaches visitors — admin form hint and `update_agent`

**Files:**
- Modify: `api/src/slices/rancher/rancher.tool.ts` (`update_agent`)
- Modify: `api/src/slices/rancher/rancher.tool.spec.ts`
- Modify: `admin/slices/agent/agent/components/agent/item/Form.vue` (Description field)

**Interfaces:**
- Consumes: `SHARE_DESCRIPTION_MAX` (500) from Task 1.
- Produces: `update_agent` parameter `description?: string | null`.

- [ ] **Step 1: Write failing tests** in `rancher.tool.spec.ts`, in the file's existing style:

```ts
it('update_agent writes description into config and keeps the rest of config', async () => {
  // existing agent config: { botName: 'x', description: 'old' }
  // call with { id, description: '  New text  ' }
  // expect agents.update called with (id, expect.objectContaining({ config: { botName: 'x', description: 'New text' } }))
});
it('update_agent clears the description on null or an empty string', async () => {
  // expect config passed to update to equal { botName: 'x' }
});
it('update_agent leaves config alone when description is absent', async () => {
  // call with { id, name: 'n' } → the update payload has config undefined
});
it('update_agent refuses a description over 500 characters', async () => {
  // zod parse of the tool parameters rejects 'x'.repeat(501)
});
```

- [ ] **Step 2: Run** `cd api && bun run test -- rancher.tool` — expected: the four FAIL.

- [ ] **Step 3: Implement.** Add `description: z.string().max(500).nullable().optional()` with a `.describe()` saying it is shown on the agent's A2A card and to people who open its share link, and that null or empty falls back to the template's. In `updateAgent`, when `description !== undefined`, pass `config: { ...existing.config, description }` (trimmed) or the same without the key when it is null/blank. It does not need a restart: leave `needsRestart` alone. Mention the description in the tool's `description` text.

- [ ] **Step 4: Run** the same command — expected: PASS. Then `bun run test -- tool` to confirm the boot-time tool metadata checks still pass.

- [ ] **Step 5: Admin form.** On the Description `Textarea` add `maxlength="500"`. Replace the hint with: "Shown on the agent card so peers know when to ask this one, and to people who open this agent's share link. Leave empty to fall back to the template description." Update the `CardDescription` above it the same way. `admin` is English-only: literal text, no i18n key.

- [ ] **Step 6: Twin check.** `grep -rn "description" app/slices/agent` — `app` has no agent form; record that for the PR body.

- [ ] **Step 7: Run** `cd admin && bun run typecheck` — expected: no errors.

- [ ] **Step 8: Commit** — `feat(agent): update_agent sets the description visitors read (CLEAN-237)`

---

### Task 3: App — the share slice knows the new fields

**Files:**
- Modify: `app/slices/share/domain/share.types.ts` (`IShareResolved`)
- Modify: `app/slices/share/data/share.mapper.ts` (`toResolved`)
- Create: `app/slices/share/data/share.mapper.test.ts`
- Regenerate: `app` and `admin` OpenAPI clients

**Interfaces:**
- Consumes: Task 1's response shape.
- Produces (in `share.types.ts`, re-exported from `domain/index.ts`): `IShareSkill`, `IShareLimits`, `IShareAttachments`, `ShareAttachmentKind` with the same field names as Task 1, and

```ts
export interface IShareResolved {
  agentId: string; agentName: string; agentStatus: string;
  description: string | null;
  skills: IShareSkill[];
  limits: IShareLimits | null;
  /** null when the API did not say — an older API, or an unreadable block. */
  attachments: IShareAttachments | null;
}
```

- [ ] **Step 1: Regenerate the clients** — `cd app && bun run build:api`, `cd admin && bun run build:api`. Expected: the generated `ShareResolvedDto` type has the four new properties.

- [ ] **Step 2: Write failing tests** in `share.mapper.test.ts` (`bun:test`, same style as `domain/shareOrigin.test.ts`):

```ts
test('reads a full answer', () => { /* every field maps through unchanged */ });
test('an answer from an older API is still a resolved link', () => {
  expect(new ShareMapper().toResolved({ agentId: 'a', agentName: 'N', agentStatus: 'running' })).toEqual({
    agentId: 'a', agentName: 'N', agentStatus: 'running',
    description: null, skills: [], limits: null, attachments: null,
  });
});
test('malformed extras degrade one by one', () => {
  const r = new ShareMapper().toResolved({
    agentId: 'a', description: 7, skills: [{ title: 'Ok' }, { title: 3 }, null, 'x'],
    limits: { perMinute: '5', perHour: 20, perDay: -1 },
    attachments: { maxPerMessage: 5 },
  });
  expect(r?.description).toBeNull();
  expect(r?.skills).toEqual([{ title: 'Ok', description: null }]);
  expect(r?.limits).toEqual({ perMinute: null, perHour: 20, perDay: null });
  expect(r?.attachments).toBeNull();
});
test('limits with no usable window are no limits', () => {
  expect(new ShareMapper().toResolved({ agentId: 'a', limits: { perHour: 0 } })?.limits).toBeNull();
});
test('unknown attachment kinds are dropped, known ones kept in order', () => { /* ['image','exe','pdf'] → ['image','pdf'] */ });
test('no agent id is still no link', () => { expect(new ShareMapper().toResolved({ agentName: 'N' })).toBeNull(); });
```

- [ ] **Step 3: Run** `cd app && bun test slices/share` — expected: FAIL.

- [ ] **Step 4: Implement** the types and extend `toResolved`, reading defensively from `unknown` as the file already does. A limit value counts only when it is a positive integer.

- [ ] **Step 5: Run** `cd app && bun test slices/share && bun run typecheck` — expected: PASS, no type errors.

- [ ] **Step 6: Twin check.** `admin/slices/share` holds the owner menu only and never calls `resolveShareLink` (`grep -rn "resolve" admin/slices/share`); record that for the PR body.

- [ ] **Step 7: Commit** — `feat(share): the visitor page reads the agent summary (CLEAN-237)`

---

### Task 4: App — header line, info button and the panel

**Files:**
- Modify: `app/package.json` (`reka-ui`, `@vueuse/core`)
- Create: `app/slices/setup/theme/components/ui/sheet/*` (copied from `admin/slices/setup/theme/components/ui/sheet/`, all ten files)
- Create: `app/slices/share/utils/shareInfo.ts`, `app/slices/share/utils/shareInfo.test.ts`
- Create: `app/slices/share/components/share/page/Info.vue` (auto-imported as `SharePageInfo`)
- Modify: `app/slices/share/components/share/page/Provider.vue` (header)
- Modify: `app/slices/share/i18n/locales/en.json`; generated: `ru.json`

**Interfaces:**
- Consumes: `IShareResolved` from Task 3; `useFormat()`; `Icon`.
- Produces (in `shareInfo.ts`, pure):

```ts
/** i18n key for the status word. Anything that is not live or starting is "unavailable". */
export function shareStatusKey(status: string): 'share.info.status_online' | 'share.info.status_starting' | 'share.info.status_unavailable';
/** One row per configured window, shortest first. */
export function shareLimitRows(limits: IShareLimits | null): { labelKey: string; count: number }[];
export function shareKindKey(kind: ShareAttachmentKind): string; // `share.info.kind_${kind}`
```

- `SharePageInfo` props: `{ resolved: IShareResolved }`; it owns the trigger button and the sheet.

- [ ] **Step 1: Add the Sheet.** `cd app && bun add reka-ui@^2.9.6 @vueuse/core@^14.3.0`, then copy the ten files. Run `cd app && bun run typecheck` — expected: no errors (the copy imports `#theme/utils`, `lucide-vue-next`, both present).

- [ ] **Step 2: Write failing tests** in `shareInfo.test.ts`:

```ts
test('status words', () => {
  expect(shareStatusKey('running')).toBe('share.info.status_online');
  expect(shareStatusKey('deploying')).toBe('share.info.status_starting');
  expect(shareStatusKey('pending')).toBe('share.info.status_starting');
  for (const s of ['failed', 'stopped', 'unreachable', '', 'anything']) {
    expect(shareStatusKey(s)).toBe('share.info.status_unavailable');
  }
});
test('limit rows: only configured windows, minute → hour → day', () => {
  expect(shareLimitRows(null)).toEqual([]);
  expect(shareLimitRows({ perMinute: null, perHour: 20, perDay: 100 })).toEqual([
    { labelKey: 'share.info.limit_hour', count: 20 },
    { labelKey: 'share.info.limit_day', count: 100 },
  ]);
  expect(shareLimitRows({ perMinute: 3, perHour: null, perDay: null })).toEqual([
    { labelKey: 'share.info.limit_minute', count: 3 },
  ]);
});
```

- [ ] **Step 3: Run** `cd app && bun test slices/share` — FAIL; implement `shareInfo.ts`; run again — PASS.

- [ ] **Step 4: Add the copy** to `en.json` under `share.info` and `share.page`:

```json
"page": { "info_open": "About this agent" },
"info": {
  "title": "About this agent",
  "status_online": "Online",
  "status_starting": "Starting",
  "status_unavailable": "Unavailable",
  "skills": "Can help with",
  "limits": "Message limits",
  "limit_minute": "Per minute",
  "limit_hour": "Per hour",
  "limit_day": "Per day",
  "limits_shared": "These limits are shared by everyone using this agent.",
  "attachments": "Attachments",
  "attachments_count": "Up to {count} files per message",
  "attachments_size": "{file} per file, {message} per message",
  "kind_image": "Images",
  "kind_pdf": "PDF",
  "kind_document": "Documents",
  "kind_spreadsheet": "Spreadsheets",
  "kind_presentation": "Presentations",
  "kind_text": "Text files",
  "privacy": "The owner of this agent can read this conversation."
}
```

Then `bun run i18n:sync` from the repo root; read the generated `ru.json` and correct anything that reads wrong through the mechanism `docs/i18n.md` prescribes, not by hand-editing first.

- [ ] **Step 5: Build `Info.vue`.** Trigger: an icon button (`Icon name="info"`), same size and style as the header's "New chat" control, `:aria-label="$t('share.page.info_open')"`. `SheetContent` on the right, `w-full sm:max-w-sm`, body scrolls (`overflow-y-auto`). Sections top to bottom, each rendered only when it has content: name + status dot + status word; description (plain interpolation with `whitespace-pre-line`, never `v-html`); skills (title, muted description); limits (label/value rows from `shareLimitRows`, counts through `useFormat()`, then `limits_shared` — the sentence is always present when the section is); attachments (count line, size line with `useFormat()` sizes, kinds as a comma-separated line of `shareKindKey`); privacy note, always. Compact: `text-sm` body, `text-xs` muted section labels, `gap-5` between sections, no cards-inside-the-sheet.

- [ ] **Step 6: Wire the header** in `Provider.vue`. The subtitle shows `resolved.description` (still `truncate`, one line) and falls back to `$t('share.page.powered_by')`. Put `<SharePageInfo v-if="resolved" :resolved="resolved" />` immediately left of `<BridleChatNewChat>`. Nothing is added to the `loading` and `invalid` branches. Update the file's header comment (it says the page draws "name + status dot").

- [ ] **Step 7: Run** `cd app && bun test slices/share && bun run typecheck`, then from the root `bun run locale:check` — expected: all clean.

- [ ] **Step 8: See it.** Run the stack (`run` skill or the repo's dev scripts), share an agent that has a description, template skills and limits, and open the link. Check: one-line description in the header; panel opens and closes with the button, Esc and the overlay; a second agent with no description, no skills and no limits shows status, attachments and privacy only; 375 px wide the sheet fills the screen and scrolls; change the description in `admin` and it arrives on the open page within 30 s; a revoked link still shows the invalid state with no info button. Screenshot the panel for the PR.

- [ ] **Step 9: Commit** — `feat(share): info panel on the visitor page (CLEAN-237)`

---

### Task 5: Ship

- [ ] **Step 1:** From the repo root: `bun run typecheck && bun run locale:check && bun run test:scripts`; `cd api && bun run test`; `cd app && bun run test`; `cd admin && bun run test`. Expected: all green. Report any failure with its output.
- [ ] **Step 2:** Bump the root `package.json` version to the next patch above the highest existing `v*` tag (`git tag --list 'v*' --sort=-v:refname | head -1`); a version that collides with an existing tag silently skips the release.
- [ ] **Step 3:** Commit `chore: bump version (CLEAN-237)`, push, open a PR into `main`. The body states: what a visitor now sees; the two spec rules revised and why; twin check — `share`: visitor page exists only in `app`, `admin/slices/share` is the owner menu and needed nothing; `agent`: the description form exists only in `admin`, `app` has no agent form; the panel screenshot.
- [ ] **Step 4:** Put the PR URL on CLEAN-237 with a closing comment. Once CI is green, confirm `gh api user` is the DREAM account, `gh pr merge <n> --merge`, watch the `Release Platform` run for that push and report its conclusion.
