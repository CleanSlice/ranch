/**
 * Strip noise from a pasted credential. Users often paste a whole `.env` line
 * (e.g. `LLM_API_KEY=sk-ant-...`) or wrap the value in quotes. Anthropic/OpenAI
 * reject that verbatim, so we normalize before persisting and before projecting
 * the value into a pod env.
 *
 * Rules (applied in order):
 *   1. Trim surrounding whitespace.
 *   2. Strip a leading `NAME=` where NAME is an uppercase env-var identifier.
 *   3. Strip a single pair of surrounding single or double quotes.
 *   4. Trim again.
 */
export function normalizeCredential(raw: string): string {
  let v = raw.trim();
  const envPrefix = v.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/s);
  if (envPrefix) v = envPrefix[2];
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v.trim();
}

/**
 * Anthropic accepts two credential types over DIFFERENT transports — sending
 * one the other's way is a hard 401 (`invalid x-api-key`):
 *  - `sk-ant-oat…` — a Claude **subscription OAuth token** (what our agents/bots
 *    run on). Must be sent as a Bearer token with the Claude Code beta headers,
 *    NOT via `x-api-key`.
 *  - anything else — a standard API key (`sk-ant-api…`), sent via `x-api-key`.
 *
 * Returns only the auth-related headers so callers merge them into their own
 * (`content-type`, `anthropic-version`). Mirrors the runtime's ClaudeRepository
 * (`data/repositories/claude`) so ranch-side calls (health check, chat
 * summaries, scenario generation) work with the exact credential the bots use.
 */
export function anthropicAuthHeaders(apiKey: string): Record<string, string> {
  if (apiKey.startsWith('sk-ant-oat')) {
    return {
      authorization: `Bearer ${apiKey}`,
      'anthropic-beta': 'oauth-2025-04-20,claude-code-20250219',
    };
  }
  return { 'x-api-key': apiKey };
}
