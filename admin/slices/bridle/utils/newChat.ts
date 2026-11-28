// What "New chat" says when the server refused it or could not do it
// (CLEAN-277). The app console has the same rule with the same wording, as
// i18n keys (`app/slices/bridle/utils/newChat.ts`); admin is English-only, so
// the sentences are here.
// Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

const GENERAL = 'Could not start a new chat. The conversation is unchanged.'

const BY_CODE: Record<string, string> = {
  AGENT_OFFLINE:
    'The agent is unavailable, so a new chat could not be started. The conversation is unchanged.',
  TURN_IN_PROGRESS: 'The agent is still answering. Try again when it has finished.',
}

/**
 * The notice for a refused or failed new chat. A code this console does not
 * know — the API can add one — gets the general sentence rather than the code
 * itself.
 */
export function newChatFailureNotice(code: string | undefined): string {
  return (code && BY_CODE[code]) || GENERAL
}

/**
 * The refusal code of an error body: on the body itself, or inside the
 * response envelope. Undefined when there is none.
 */
export function newChatRefusalCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const outer = body as { code?: unknown; data?: unknown }
  if (typeof outer.code === 'string') return outer.code
  const inner = outer.data
  if (inner && typeof inner === 'object') {
    const code = (inner as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}
