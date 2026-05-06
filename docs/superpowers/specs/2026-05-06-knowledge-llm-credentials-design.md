# Knowledge UX + LLM credential capabilities (Phase 1)

**Status:** draft
**Date:** 2026-05-06
**Branch:** `feat/reins-lightrag`

## Problem

Knowledge (LightRAG-backed RAG service) is wired into the admin and runtime but is not usable end-to-end without manual intervention. Concrete pain points surfaced in the 2026-05-06 sync:

1. The OpenAI API key consumed by LightRAG (for both LLM and embedding bindings) lives in a developer's personal `.env` and the `lightrag-api` k8s secret. There is no UI flow for a teammate to plug in their own key.
2. `LlmCredential` does not distinguish chat-capable models from embedding-capable models. The Knowledge service has no way to filter the existing credentials, so it cannot expose a "pick an embedding credential" UX.
3. The LLM credential form uses free-text inputs for `provider` and `model`. New teammates type `Senate` instead of `claude-sonnet-4-6` and the agent fails silently.
4. When the Knowledge service is not configured, `/knowledges` renders an empty list with no guidance. The CTO explicitly asked for the page to show what is missing rather than be hidden or empty.
5. Step-by-step onboarding for Knowledge is missing. The Rancher template flow has it, the Knowledge flow does not.

This spec covers the Phase 1 work to fix items 2 through 5 and stage data for item 1. Auto-syncing the OpenAI key into the LightRAG container is deferred to Phase 2.

## Goal

A teammate clones the repo, runs `make dev`, opens the admin, and can bring Knowledge to "ready" without editing files. They follow a wizard on `/knowledges`: create an embedding LLM credential, create a chat LLM credential, fill in `/settings/knowledge`, restart LightRAG (instructions provided in copy-pasteable form), and the wizard reports green.

## Decisions

| Question | Choice |
|---|---|
| Sync key into LightRAG | Phase 1: store selection in admin, document `.env` / secret update + restart. Phase 2: separate spec |
| Capability shape | Two booleans on `LlmCredential`: `supportsChat`, `supportsEmbedding` |
| Source of model list | Static hardcoded in `admin/slices/llm/data/providers.ts` |
| Knowledge UX when not configured | Step-by-step wizard rendered above the list on `/knowledges` |
| Slice coupling | Tight integration with `llm` slice (knowledge consumes LLM credentials) |
| Provider id naming | Keep storage value `claude` (runtime knows both `claude` and `anthropic`); display label `Anthropic` |
| Model select side-effect | Auto-fill capability checkboxes from the static model definition; user can override |
| Credential-form validation | Reject save when both capabilities are `false` |
| Knowledge-settings validation | When `enabled=true`, both `chat_credential_id` and `embedding_credential_id` are required |
| Tests | None added in this phase (per repo convention: ranch has no test suite) |

## 1. Data model: `LlmCredential` capabilities

`api/src/slices/llm/llm.prisma`:

```prisma
model LlmCredential {
  // existing fields preserved
  supportsChat      Boolean @default(true)
  supportsEmbedding Boolean @default(false)
}
```

Migration adds the two columns with the defaults shown. Existing rows inherit `chat=true, embedding=false` which is correct: every existing credential was created for an agent (chat usage).

Updated touchpoints (no new files):
- `api/src/slices/llm/dtos/llmCredential.dto.ts`: add `supportsChat`, `supportsEmbedding` (boolean) to the response DTO and to `CreateLlmCredentialDto` / `UpdateLlmCredentialDto`.
- `api/src/slices/llm/domain/llm.types.ts`: extend `ILlmCredentialData`, `ICreateLlmCredentialData`, `IUpdateLlmCredentialData` with the new flags.
- `api/src/slices/llm/data/llm.mapper.ts`: pass-through.
- `admin/slices/llm/stores/llm.ts`: extend `ILlmCredentialData` and `ILlmCredentialInput`. Update `unwrap` consumers.

## 2. Static providers/models definition

New file `admin/slices/llm/data/providers.ts`:

```ts
export interface IModelDef {
  id: string;
  label: string;
  capabilities: { chat: boolean; embedding: boolean };
}

export interface IProviderDef {
  id: string;
  label: string;
  models: IModelDef[];
}

export const PROVIDERS: IProviderDef[] = [
  {
    id: 'claude',
    label: 'Anthropic',
    models: [
      { id: 'claude-opus-4-7',   label: 'Claude Opus 4.7',   capabilities: { chat: true,  embedding: false } },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', capabilities: { chat: true,  embedding: false } },
      { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  capabilities: { chat: true,  embedding: false } },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o',                 label: 'GPT-4o',            capabilities: { chat: true,  embedding: false } },
      { id: 'gpt-4o-mini',            label: 'GPT-4o mini',       capabilities: { chat: true,  embedding: false } },
      { id: 'text-embedding-3-small', label: 'Embedding 3 small', capabilities: { chat: false, embedding: true  } },
      { id: 'text-embedding-3-large', label: 'Embedding 3 large', capabilities: { chat: false, embedding: true  } },
    ],
  },
];

export function getProvider(id: string): IProviderDef | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

export function getModel(providerId: string, modelId: string): IModelDef | null {
  const provider = getProvider(providerId);
  if (provider === null) return null;
  return provider.models.find((m) => m.id === modelId) ?? null;
}

export function isProviderId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return PROVIDERS.some((p) => p.id === value);
}
```

When the project later adds providers (Mistral, DeepSeek, OpenRouter), this file is the single edit point.

## 3. UI: LLM credential form

`admin/slices/llm/components/llm/Form.vue` rewrites the provider and model controls:

- `provider`: native `<select>` populated from `PROVIDERS`. Each `<option>` shows `provider.label`, value is `provider.id`.
- `model`: native `<select>` filtered by the chosen provider's `models`. Disabled until provider is selected.
- `fallbackModel`: same filter as `model`, plus an explicit "(none)" option.
- Two `<Checkbox>` controls: `supportsChat`, `supportsEmbedding`.
- On model change: capability checkboxes reset to the chosen model's static `capabilities`. The user can override the result by manually toggling either checkbox; manual overrides do not survive a subsequent model change. Rationale: the static definition is authoritative; predictable state is better than a layered override system.
- On initial form load (edit mode): checkboxes are populated from the credential's stored `supportsChat` / `supportsEmbedding` values. The static model definition is not consulted at this point, so legacy rows keep their stored capabilities even if the model id is not in the static list.
- `validate()`: error if `supportsChat === false && supportsEmbedding === false`. Existing validations for provider, model, apiKey are kept.

Legacy values: when an existing credential has `provider='claude'` (already in dropdown) but `model='claude-3-5-sonnet-20241022'` (not in dropdown), the form renders the model select with an extra `<option>` "claude-3-5-sonnet-20241022 (custom)" so the existing value displays correctly. Saving without changing keeps the legacy string in DB. A small inline note suggests updating to a known model.

Deep link: `admin/slices/llm/pages/llms/create.vue` reads `?capability=chat` or `?capability=embedding` from the route and pre-checks the matching checkbox. The wizard CTAs use these query params.

## 4. UI: Knowledge settings credential pickers

`admin/slices/setting/pages/settings/knowledge.vue` adds a new "LLM credentials" card between the existing "Enable" toggle and the URL/api_key/s3_bucket fields.

Two dropdowns:
- "Chat LLM credential": filtered to credentials where `supportsChat===true`. Bound to setting `{group:'knowledge', key:'chat_credential_id'}`.
- "Embedding LLM credential": filtered to `supportsEmbedding===true`. Bound to `{group:'knowledge', key:'embedding_credential_id'}`.

Below each dropdown, a small one-liner: "Used by LightRAG container as `LLM_BINDING` / `LLM_MODEL` / `LLM_BINDING_API_KEY`" and "...as `EMBEDDING_BINDING` / `EMBEDDING_MODEL` / `EMBEDDING_BINDING_API_KEY`" respectively.

Below the card, an info banner:

> "After changing credentials or service URL, update `OPENAI_API_KEY` and embedding/LLM model env vars in your `.env` (local dev) or the `lightrag-api` k8s secret (prod), then restart the LightRAG container or pod. Auto-sync of these values from the admin is planned for a follow-up phase."

Save behavior: validation lives on the frontend in `onSave()`. The existing `settingStore.upsert` is a generic per-key endpoint, so adding cross-key validation there is wrong layering. Before issuing the upsert calls, `onSave()` checks: if `enabled === true` and either `chat_credential_id` or `embedding_credential_id` is empty, set `errorMessage` and return without calling the API. The user must either uncheck `enabled` or pick credentials. We accept that a non-admin API client could bypass this validation; the admin is the only consumer in scope.

Store consumption: the page calls `useLlmStore().fetchAll()` once on mount; the dropdowns reactively filter from `items`.

## 5. UI: Knowledge setup wizard

New component `admin/slices/reins/components/knowledgeSetup/Wizard.vue` plus a small `Step.vue` child for visual rows.

Mounted on `admin/slices/reins/pages/knowledges/index.vue` above the existing `<KnowledgeListProvider />`. Reads from `useKnowledgeStore().fetchStatus()` (extended in section 6).

Steps (rendered top to bottom, each shows pending or done):

1. **Embedding credential** (`status.setup.hasEmbeddingCredential`)
   - Description: "Create an LLM credential that supports embedding (e.g. OpenAI text-embedding-3-small)."
   - CTA button: link to `/llms/create?capability=embedding`.
2. **Chat credential** (`status.setup.hasChatCredential`)
   - Description: "Create an LLM credential that supports chat (e.g. OpenAI gpt-4o-mini or Anthropic Claude)."
   - CTA: `/llms/create?capability=chat`.
3. **Knowledge service config** (combination of `hasUrl && hasBucket && hasCredentialsSelected && enabled`)
   - Description: "Set the LightRAG URL, S3 bucket, pick chat/embedding credentials, then enable the service."
   - CTA: `/settings/knowledge`.
4. **LightRAG reachable** (`status.setup.isHealthy`)
   - Description: "After changing config, restart LightRAG so it picks up the new env vars."
   - Body: two code blocks, each with a small "Copy" button that writes the command to the clipboard via `navigator.clipboard.writeText`. The buttons do not hit any API. The first block: `make dev` (local docker-compose). The second: `kubectl rollout restart deploy/lightrag -n platform` (k8s). A short note above each: "Local" / "Kubernetes".

When all four steps are done, the wizard collapses to a one-line "Knowledge is ready" badge and the list renders below. While any step is pending, the list does not render. This avoids the empty-list confusion the CTO flagged.

A11y: each step is a `<li>` with an `aria-current` for the first pending step.

## 6. API: extended status endpoint

`api/src/slices/reins/knowledge/knowledge.controller.ts`, `GET /knowledges/status`:

```ts
async status(): Promise<{
  enabled: boolean;
  setup: {
    hasEmbeddingCredential: boolean;
    hasChatCredential: boolean;
    hasUrl: boolean;
    hasBucket: boolean;
    hasCredentialsSelected: boolean;
    isHealthy: boolean;
  };
}>
```

`enabled` keeps its current semantics for backward compat (already consumed by `admin/slices/agent/template/components/template/Form.vue`). The new `setup` object is consumed by the wizard.

Resolution logic:
- `hasEmbeddingCredential` / `hasChatCredential`: new method on `ILlmGateway`:
  ```ts
  hasCredentialWithCapability(capability: 'chat' | 'embedding'): Promise<boolean>;
  ```
  Implementation in `data/llm.gateway.ts` runs a single `prisma.llmCredential.count({ where: { status: 'active', supportsChat: true } })` (or `supportsEmbedding: true` depending on the argument) and returns `count > 0`.
- `hasUrl` / `hasBucket`: read via `KnowledgeConfigGateway.resolve()` and check non-empty.
- `hasCredentialsSelected`: read settings `knowledge/chat_credential_id` and `knowledge/embedding_credential_id`, both non-empty.
- `isHealthy`: call `LightragHttpClient.health()` under try/catch, with a 2-second `AbortController` timeout passed into the existing `fetchImpl` call. Any failure (network, 5xx, missing URL, `ServiceUnavailableException`) returns `false`. Successful health check returns `true`.

The controller's resolution functions run in parallel via `Promise.all` to keep the endpoint fast.

The store update: `admin/slices/reins/stores/knowledge.ts` extends `fetchStatus()` to parse the new `setup` object via a type guard. Existing `enabled` boolean ref stays. New `setup` ref is added with the same type as the response. The wizard reads from `setup`.

## 7. Data flow (happy path)

1. User opens `/knowledges`. The page calls `store.fetchStatus()`.
2. API returns `{ enabled: false, setup: { hasEmbeddingCredential: false, ...all false } }`.
3. Wizard renders with all four steps pending. Step 1 is `aria-current`.
4. User clicks "Create embedding credential" CTA. Browser navigates to `/llms/create?capability=embedding`.
5. The form pre-checks "Use for embedding". User picks provider OpenAI from the dropdown. The model dropdown filters to OpenAI models.
6. User picks `text-embedding-3-small`. The model's static `capabilities.embedding=true` keeps the embedding box checked. Chat box stays unchecked because the model has `chat=false`.
7. User pastes the OpenAI API key, submits. Credential is created with `supportsChat=false, supportsEmbedding=true`.
8. User navigates back to `/knowledges`. `fetchStatus` re-runs. Step 1 now reports done.
9. User repeats for a chat credential (`?capability=chat`). Step 2 reports done.
10. User opens `/settings/knowledge`. Picks the two new credentials in the dropdowns. Fills URL and S3 bucket. Toggles `enabled`. Saves.
11. `fetchStatus` reports `hasCredentialsSelected=true`, `enabled=true`. Step 3 done.
12. Step 4 still pending: LightRAG container has not been restarted with new env vars, so its OpenAI binding is wrong (or not configured). The user follows the copy-pasteable command from the wizard. After restart, health probe succeeds.
13. All four steps green. Wizard collapses. List renders.

## 8. Out of scope (Phase 2)

- Auto-syncing settings to `.env` (docker-compose) and to the `lightrag-api` k8s secret.
- Auto-restarting LightRAG (compose container or k8s pod) after config change.
- Fetching the live model list from Anthropic `/v1/models` and OpenAI `/v1/models` (a "Refresh models" button).
- Per-knowledge embedding override. LightRAG configures embeddings at container level, so per-knowledge override is a LightRAG-level concern, not an admin one.
- Multi-tenant LightRAG (one LightRAG per tenant). Out of scope here.

## 9. Migration and backward compatibility

- Prisma migration adds `supportsChat`, `supportsEmbedding` columns with the defaults shown in section 1.
- Provider id `claude` stays in DB. The dropdown shows it labeled "Anthropic". Runtime code (`paddockRunner.ts`, `scenarioGenerator.gateway.ts`) already accepts both `claude` and `anthropic`, so no rename is needed.
- Legacy model strings (e.g. `claude-3-5-sonnet-20241022`) not in the static list: form renders them as a "(custom)" option in the dropdown. Save preserves the legacy string. A subtle inline warning suggests updating to a known model.
- Knowledge `/status` endpoint stays backward-compatible: the existing `enabled: boolean` is preserved; the new `setup` object is additive. Consumers that only read `enabled` keep working.
- New settings keys `knowledge/chat_credential_id` and `knowledge/embedding_credential_id` default to empty. Until set, the wizard step 3 stays pending.

## 10. Risks and open questions

- **Health probe noise.** If LightRAG is up but in a partial state (e.g. running but binding misconfigured), `/health` may return ok and the wizard reports green even though queries fail. Mitigation: the health check is best-effort, and a real query failure surfaces in the existing knowledge index/query UX. We accept this trade-off in Phase 1.
- **Custom legacy models.** A user with a `provider`/`model` combination not in the static list keeps it after saving the form (not breaking). The "(custom)" option is a soft UX, not a guarantee. If we later decide to enforce dropdown values strictly, that is a separate cleanup.
- **Validation gap.** Saving Knowledge settings with `enabled=true` is rejected when credentials are missing. The settings page already has an `errorMessage` ref; we hook into that. We do not block the user from picking a credential whose `apiKey` is wrong; the failure surfaces only at LightRAG runtime.
- **Phase 2 trigger.** When a teammate complains that "I changed the OpenAI credential and Knowledge still uses the old one", that is the signal to start Phase 2 (auto-sync and restart). Until then, Phase 1 with documented restart is acceptable.
- **No tests.** Consistent with repo convention. Manual QA plan: open browser, click every dropdown, verify wizard steps update reactively after each create/save, verify list re-appears once all steps are green.

## References

- Related spec: [Reins slice refactor (knowledge / source / config / lightrag)](2026-05-01-reins-refactor-design.md)
- Related spec: [Reins LightRAG integration](2026-04-23-reins-lightrag-integration-design.md)
- LightRAG deployment: `k8s/platform/lightrag/deployment.yaml`, `api/docker-compose.yml`
- Static provider list (planned): `admin/slices/llm/data/providers.ts`
