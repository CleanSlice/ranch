export interface ILlmProviderBinding {
  provider: string;
  param: string;
  env: string;
}

export const LLM_PROVIDER_BINDINGS: ILlmProviderBinding[] = [
  { provider: 'anthropic', param: 'anthropic-api-key', env: 'ANTHROPIC_API_KEY' },
  { provider: 'openai', param: 'openai-api-key', env: 'OPENAI_API_KEY' },
  { provider: 'google', param: 'google-api-key', env: 'GOOGLE_API_KEY' },
  { provider: 'xai', param: 'xai-api-key', env: 'XAI_API_KEY' },
  {
    provider: 'claude-code',
    param: 'claude-code-oauth-token',
    env: 'CLAUDE_CODE_OAUTH_TOKEN',
  },
];
