import { anthropicAuthHeaders, normalizeCredential } from './llm.utils';

describe('anthropicAuthHeaders', () => {
  it('sends an OAuth subscription token as Bearer + claude-code beta (never x-api-key)', () => {
    const h = anthropicAuthHeaders('sk-ant-oat01-abc123');
    expect(h.authorization).toBe('Bearer sk-ant-oat01-abc123');
    expect(h['anthropic-beta']).toBe('oauth-2025-04-20,claude-code-20250219');
    expect(h['x-api-key']).toBeUndefined();
  });

  it('sends a standard API key via x-api-key (no Bearer, no beta)', () => {
    const h = anthropicAuthHeaders('sk-ant-api03-xyz789');
    expect(h['x-api-key']).toBe('sk-ant-api03-xyz789');
    expect(h.authorization).toBeUndefined();
    expect(h['anthropic-beta']).toBeUndefined();
  });
});

describe('normalizeCredential', () => {
  it('strips an env-var prefix and surrounding quotes', () => {
    expect(normalizeCredential('LLM_API_KEY="sk-ant-oat01-x"')).toBe(
      'sk-ant-oat01-x',
    );
  });
});
