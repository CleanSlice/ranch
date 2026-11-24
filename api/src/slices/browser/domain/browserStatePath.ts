/**
 * Where an agent keeps a chat identity's browser sessions (CLEAN-244): one
 * folder per identity, `browser-state/<identity>/<profile>.json`.
 *
 * The old layout was flat, `browser-state/<identity>-<profile>.json`, and the
 * dash is in ids and profile names alike, so two pairs could name one file:
 * share visitor `share-abc-def` with profile `private`, and `share-abc` — a
 * visitor picks the tail of their own id — asking for `def-private`.
 *
 * The runtime reads and writes the same paths
 * (runtime: src/slices/agent/tool/data/repositories/browser/browserStatePath.ts)
 * — change them together.
 */

/**
 * An identity as a folder name, reversibly: letters, digits, `_` and `-`
 * stay, every other byte becomes `~` and two hex digits — `~` itself
 * included, so two ids never share a folder, and no folder is `.` or `..`.
 */
export function identityFolder(identity: string): string {
  let out = '';
  for (const byte of Buffer.from(identity, 'utf8')) {
    const ch = String.fromCharCode(byte);
    out += /[A-Za-z0-9_-]/.test(ch)
      ? ch
      : `~${byte.toString(16).padStart(2, '0')}`;
  }
  return out;
}

/** The state file of `profile` (already canonical) for `identity`. */
export function browserStatePath(identity: string, profile: string): string {
  return `browser-state/${identityFolder(identity)}/${profile}.json`;
}

/**
 * Ids whose old flat name was never ambiguous — no other id is one of them
 * with a dash and more after it: the Owner (`admin`), an account
 * (`user-<uuid>`), an id with no dash at all other than a namespace's first
 * word. The runtime claims old files by the same rule.
 */
const LEGACY_SAFE_RE =
  /^(admin|user-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_]+)$/;
const NAMESPACE_WORDS = new Set([
  'user',
  'share',
  'anon',
  'peer',
  'handover',
  'agent',
]);

/**
 * The same in the old flat layout, or null — written alongside for agents
 * still on a runtime before 0.39, which look only there, and only for an id
 * whose old name was never ambiguous (the extension writes for `admin` and
 * `user-<uuid>`). A 0.39 runtime moves it into the folder, or drops it when
 * the folder has it. Drop this once every agent runs 0.39 or later.
 */
export function legacyBrowserStatePath(
  identity: string,
  profile: string,
): string | null {
  if (!LEGACY_SAFE_RE.test(identity) || NAMESPACE_WORDS.has(identity)) {
    return null;
  }
  return `browser-state/${identity}-${profile}.json`;
}
