// Twin of admin/slices/bridle/utils/draftLink.ts — change them together.
//
// A link may carry a message to start from (CLEAN-243): the Ranch Cookies
// extension opens an agent's chat with what to tell the agent already in the
// box — the session it was just handed and the profile to open it with. The
// text is put in the composer and never sent; the person finishes it and
// presses Enter. Pure on purpose, so `bun test` runs it.

/** The query parameter a link puts its message in. */
export const DRAFT_QUERY_KEY = 'draft';

/** A link's message is a starter, not a document. */
export const MAX_LINK_DRAFT_LENGTH = 2000;

/**
 * The message a link carries, or null when it carries none. Control
 * characters other than line breaks and tabs are dropped, and an overlong
 * one is cut, so a crafted link can neither hide text nor flood the box.
 */
export function draftFromQuery(query: Record<string, unknown>): string | null {
  const raw = query[DRAFT_QUERY_KEY];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, MAX_LINK_DRAFT_LENGTH) : null;
}

/** The same query without the message, so a reload does not put it back. */
export function withoutDraft<Q extends Record<string, unknown>>(query: Q): Q {
  const { [DRAFT_QUERY_KEY]: _dropped, ...rest } = query;
  void _dropped;
  return rest as Q;
}

/** The box after the link's message joins whatever was typed already. */
export function withLinkDraft(current: string, draft: string): string {
  return current.trim() ? `${current.replace(/\s+$/, '')}\n\n${draft}` : draft;
}
