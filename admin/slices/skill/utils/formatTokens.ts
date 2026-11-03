/**
 * `880`, `1.7k`, `18.9k`, `120k` — the size of a skill or of the library,
 * always next to a "≈" because it is `ceil(chars / 4)`, not a tokenizer.
 * One decimal while the number is short enough to read at a glance, none
 * once the thousands alone say what matters. Pure: no locale, no Intl, so
 * the locale check stays clean and a test pins the format.
 */
export function formatTokens(tokens: number): string {
  const n = Math.max(0, Math.round(tokens));
  if (n < 1000) return String(n);
  if (n < 100_000) {
    const k = (n / 1000).toFixed(1);
    return `${k.endsWith('.0') ? k.slice(0, -2) : k}k`;
  }
  return `${Math.round(n / 1000)}k`;
}
