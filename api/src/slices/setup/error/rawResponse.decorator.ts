import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_METADATA_KEY = 'raw_response';

/**
 * Opt a route out of the `{ success, data }` envelope every other 2xx body
 * carries.
 *
 * There is exactly one reason to reach for this: a route that speaks somebody
 * else's protocol. The A2A endpoints (CLEAN-74) answer with an agent card and
 * with JSON-RPC envelopes, both defined by a published spec — a client reading
 * `{ success: true, data: { … } }` would see neither. Ranch's own API keeps the
 * envelope, and any new use of this decorator should be able to name the
 * external specification it is obeying.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_METADATA_KEY, true);
