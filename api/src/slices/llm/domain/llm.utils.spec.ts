import {
  anthropicAuthHeaders,
  isAnthropicSubscriptionToken,
  normalizeCredential,
} from './llm.utils';

// One place says which kind a key is (CLEAN-280): the headers are chosen by
// it, and so is the credential the summary batch prefers.
describe('isAnthropicSubscriptionToken', () => {
  it('is true for an OAuth subscription token, the kind the agents run on', () => {
    expect(isAnthropicSubscriptionToken('sk-ant-oat01-abc123')).toBe(true);
  });

  it.each([
    ['a standard API key', 'sk-ant-api03-xyz789'],
    ['a key of no known shape', 'sk'],
    ['an empty key', ''],
  ])('is false for %s', (_name, key) => {
    expect(isAnthropicSubscriptionToken(key)).toBe(false);
  });

  it('agrees with the headers: a subscription token is the one sent as Bearer', () => {
    for (const key of ['sk-ant-oat01-abc123', 'sk-ant-api03-xyz789', 'sk']) {
      expect('authorization' in anthropicAuthHeaders(key)).toBe(
        isAnthropicSubscriptionToken(key),
      );
    }
  });
});

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
