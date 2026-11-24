// Twin of app/slices/bridle/utils/draftLink.ts — change them together.
//
// A chat link may say a session was just shared with the agent (CLEAN-243):
// the Ranch Cookies extension opens the agent's chat with
// `?shared=<profile>&site=<host>` after handing it a site's cookies. The
// console writes the message itself, from its own words and those two
// checked values, and puts it in the box; it is never sent by itself. A
// link never carries free text: one that could would let anybody put
// instructions in front of an agent for the next Enter. Pure on purpose, so
// `bun test` runs it.

/** The query parameters a link names the shared session with. */
export const SHARED_PROFILE_KEY = 'shared'
export const SHARED_SITE_KEY = 'site'

/** A browser profile name, as the extension and the runtime write them. */
const PROFILE_RE = /^[a-zA-Z0-9_:.-]{1,60}$/
/** A host name: labels of letters, digits and dashes, dot-separated. */
const SITE_RE = /^(?=.{1,253}$)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*$/i

export interface ISharedSession {
  /** The browser profile the agent opens the site with. */
  profile: string
  /** The site, as a host name. */
  site: string
}

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value)

/** The session a link names, or null when it names none or a malformed one. */
export function sharedSessionFromQuery(query: Record<string, unknown>): ISharedSession | null {
  const profile = first(query[SHARED_PROFILE_KEY])
  const site = first(query[SHARED_SITE_KEY])
  if (typeof profile !== 'string' || !PROFILE_RE.test(profile)) return null
  if (typeof site !== 'string' || !SITE_RE.test(site)) return null
  return { profile, site: site.toLowerCase() }
}

/** The same query without the two, so a reload does not put the message back. */
export function withoutSharedSession<Q extends Record<string, unknown>>(query: Q): Q {
  const { [SHARED_PROFILE_KEY]: _profile, [SHARED_SITE_KEY]: _site, ...rest } = query
  void _profile
  void _site
  return rest as Q
}

/** The box after the console's message joins whatever was typed already. */
export function withLinkDraft(current: string, draft: string): string {
  return current.trim() ? `${current.replace(/\s+$/, '')}\n\n${draft}` : draft
}

/** The message the admin console writes for a shared session (English only). */
export function sharedSessionDraft({ profile, site }: ISharedSession): string {
  return (
    `I've shared my ${site} session with you as the browser profile "${profile}". ` +
    `Open ${site} with browser_play(profile: "${profile}") — you're signed in as me there — and «what to do there».`
  )
}
