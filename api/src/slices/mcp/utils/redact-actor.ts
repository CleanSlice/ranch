import { ACTOR_META_KEY } from '../interfaces/acting-party.interface';

/** What stands in for the token in a log line. */
export const REDACTED_ACTOR_TOKEN = '[redacted]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactMessage(message: unknown): unknown {
  if (!isRecord(message)) return message;
  const params = message.params;
  if (!isRecord(params)) return message;
  const meta = params._meta;
  if (!isRecord(meta)) return message;
  const actor = meta[ACTOR_META_KEY];
  if (!isRecord(actor) || !('token' in actor)) return message;
  return {
    ...message,
    params: {
      ...params,
      _meta: {
        ...meta,
        [ACTOR_META_KEY]: { ...actor, token: REDACTED_ACTOR_TOKEN },
      },
    },
  };
}

/**
 * An MCP request body as it may be written to a log (CLEAN-232).
 *
 * Every tools/list and tools/call from an agent runtime carries the acting
 * token of the person the turn is for, in `params._meta["ranch/actor"]`. It
 * is a bearer-grade secret for an hour: whoever reads it out of a debug log
 * can make tool calls as that person through the agent it was minted for.
 * So the token is replaced before logging and everything else is logged as
 * before, the actor's `kind` included, which is what a reader of the log
 * needs.
 *
 * Returns a copy; the body handed to the transport is never touched. A batch
 * (an array of messages) is handled message by message. Anything that is not
 * a JSON-RPC message comes back as it is.
 */
export function redactActorToken(body: unknown): unknown {
  return Array.isArray(body) ? body.map(redactMessage) : redactMessage(body);
}
