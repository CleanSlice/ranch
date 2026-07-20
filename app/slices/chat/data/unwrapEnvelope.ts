/**
 * The API wraps every 2xx body in `{ success, data }`, but the generated
 * client types each response as the *inner* payload — so `res.data` is typed as
 * the DTO while at runtime it is the envelope. Peel it here, at the single data
 * boundary, so mappers receive the DTO the types already promise and no layer
 * above ever deals with the envelope.
 */
export function unwrapEnvelope<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as { data?: unknown })) {
    return ((body as { data?: unknown }).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}
