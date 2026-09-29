import type { IBridleNotice } from '../domain/bridle.types';

const BYTES_SUFFIX = 'Bytes';

/**
 * A notice's parameters, ready for `$t`.
 *
 * A notice is stored as a key and raw values, and is worded when it is shown —
 * a size written into the store would stay in the language that was active at
 * the time, and would not follow a switch. So a byte count travels as a number
 * under a name ending in `Bytes` and becomes a size here: `limitBytes` fills
 * `{limit}`.
 *
 * Pure on purpose: `size` is handed in (`useFormat().size`), so this runs under
 * `bun test` without a component around it.
 */
export function noticeParams(
  notice: IBridleNotice,
  size: (bytes: number) => string,
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(notice.params ?? {})) {
    if (typeof value === 'number' && name.endsWith(BYTES_SUFFIX) && name !== BYTES_SUFFIX) {
      params[name.slice(0, -BYTES_SUFFIX.length)] = size(value);
    } else {
      params[name] = value;
    }
  }
  return params;
}
