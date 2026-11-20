/**
 * The id of the signed-in person's own conversation with an agent
 * (CLEAN-236), by the rule the hub applies to the same token
 * (`clientIdFromJwtPayload` in the API): the Owner keeps `admin`, the id of
 * the conversation every administrator used to share, and everybody else is
 * their own user id.
 *
 * The console needs it before the socket's `welcome` says so: the
 * transcript is loaded by this name, and the conversation record in the
 * store is keyed by it. A wrong guess is not a way in. The API answers a
 * channel that is not the caller's by its own rule.
 */
export const OWNER_CHANNEL = 'admin'

export function ownChannel(
  user: { id?: string | null; role?: string | null } | null | undefined,
): string {
  if (!user?.id || user.role === 'Owner') return OWNER_CHANNEL
  return user.id
}
