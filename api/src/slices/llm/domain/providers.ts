// @scope:api
// @slice:llm
// @layer:domain
// @type:catalogue

/**
 * The providers and models Ranch knows how to talk to. The console's
 * credential form is built from the same list (`admin/slices/llm/data/
 * providers.ts`); keep the two in step. A credential may still name a model
 * that is not here — the list is what Ranch can vouch for, not a whitelist.
 */
export interface ILlmModelDef {
  id: string;
  label: string;
  capabilities: { chat: boolean; embedding: boolean };
}

export interface ILlmProviderDef {
  id: string;
  label: string;
  /** Other spellings a credential row may carry for this provider. */
  aliases: string[];
  models: ILlmModelDef[];
}

export const LLM_PROVIDERS: ILlmProviderDef[] = [
  {
    id: 'claude',
    label: 'Anthropic',
    aliases: ['anthropic'],
    models: [
      {
        id: 'claude-opus-4-7',
        label: 'Claude Opus 4.7',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        capabilities: { chat: true, embedding: false },
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    aliases: [],
    models: [
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'text-embedding-3-small',
        label: 'Embedding 3 small',
        capabilities: { chat: false, embedding: true },
      },
      {
        id: 'text-embedding-3-large',
        label: 'Embedding 3 large',
        capabilities: { chat: false, embedding: true },
      },
    ],
  },
];

/** Case-insensitive, alias-aware: `Anthropic` and `claude` are one provider. */
export function findLlmProvider(id: string): ILlmProviderDef | null {
  const key = id.trim().toLowerCase();
  return (
    LLM_PROVIDERS.find((p) => p.id === key || p.aliases.includes(key)) ?? null
  );
}
