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
