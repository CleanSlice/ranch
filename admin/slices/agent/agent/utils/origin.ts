/**
 * One allowed origin, as typed into the Access block (CLEAN-228, research R9).
 *
 * An origin is scheme + host + optional port and nothing else — that is what a
 * browser sends in the `Origin` header, so a path or a wildcard could never
 * match. A trailing slash is what people paste; it is stripped, not refused.
 *
 * No Vue / Nuxt imports: this file runs under `bun test`.
 */

export type ParsedOrigin = { ok: true; origin: string } | { ok: false };

const ORIGIN = /^(https?):\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:]+\])(:([0-9]{1,5}))?$/i;

export function parseOrigin(text: string): ParsedOrigin {
  let candidate = String(text ?? '').trim();
  let end = candidate.length;
  for (let i = candidate.length - 1; i >= 0 && candidate[i] === '/'; i -= 1) {
    end = i;
  }
  candidate = candidate.slice(0, end);
  if (!candidate) return { ok: false };
  const match = ORIGIN.exec(candidate);
  if (!match) return { ok: false };
  const port = match[7];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) {
    return { ok: false };
  }
  // Scheme and host compare case-insensitively in a browser; store one form.
  return { ok: true, origin: candidate.toLowerCase() };
}
