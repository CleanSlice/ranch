import { HttpException } from '@nestjs/common';
import { err, type ToolResult } from '#/mcp/tooling';
import { PeerErrorCodes, type IAgentPeerView } from './domain/peer.types';

// The result shape and caller helpers moved to the shared `#/mcp/tooling`
// (CLEAN-109) so every tool file speaks the same vocabulary; re-exported here
// so the peer tools and their specs read as before.
export {
  ok,
  err,
  callerAgentId,
  callerIsOperator,
  type ToolResult,
} from '#/mcp/tooling';

/** Peers as a model needs them: what it is, what it claims, is it usable. */
export function toToolPeer(view: IAgentPeerView) {
  return {
    peerId: view.id,
    name: view.peerName,
    origin: view.origin,
    status: view.peerStatus,
    exists: view.peerExists,
    address: view.cardUrl,
    description: view.card?.description ?? '',
    skills: (view.card?.skills ?? []).map((s) => ({
      name: s.name,
      description: s.description,
    })),
    cardReadAt: view.cardReadAt,
  };
}

/**
 * A peer with an empty card is connected and useless: the delegating model
 * matches questions against this text, so "nothing advertised" is the single
 * most useful thing to say back at connect time (CLEAN-95).
 */
export function advertises(view: IAgentPeerView): string {
  const skills = view.card?.skills ?? [];
  if (skills.length) {
    return `It advertises: ${skills.map((s) => s.name).join(', ')}.`;
  }
  return view.card?.description
    ? 'Its card lists no skills, so matching leans on its description alone.'
    : 'Warning: its card advertises nothing — no description, no skills. It ' +
        'will only ever be asked when the person names it outright.';
}

/**
 * Refusals the peer service raises, and what the model should do about each.
 * The tools that can hit a given code name their own way out of it — the
 * operator set sends you to `connect_agent_peer`, the self-service set to
 * `connect_my_peer` — so the advice is passed in, not baked in here.
 */
export type RefusalHints = Partial<Record<string, string>>;

/** Hints that read the same whoever is asking. */
export const SHARED_HINTS: RefusalHints = {
  [PeerErrorCodes.Version]:
    'Nothing was saved. Ranch speaks A2A 1.0 only; ask its owner whether it ' +
    'publishes a 1.0 card.',
  [PeerErrorCodes.Binding]:
    'Nothing was saved. Ranch calls agents over JSON-RPC only.',
  [PeerErrorCodes.UrlInvalid]: 'Nothing was saved. Check the address.',
  [PeerErrorCodes.UrlUnreachable]:
    'Nothing was saved. Tell the person the address did not answer; do not ' +
    'invent what that agent can do.',
  [PeerErrorCodes.CardUnreachable]:
    'Nothing was saved — the card could not be read.',
  [PeerErrorCodes.Self]: 'An agent cannot be its own peer.',
};

/**
 * The MCP layer turns a thrown error into `isError` text already. This adds
 * the one thing it cannot: what to do next. A refusal that names the fix
 * ("that address is ours — connect it by id") is the difference between the
 * agent correcting itself and the agent telling the person it cannot be done.
 *
 * Anything that is not an HttpException is left to escape: a database that is
 * down is not a refusal, and dressing it up as advice would be a lie.
 */
export async function withRefusalAdvice(
  run: () => Promise<ToolResult>,
  hints: RefusalHints,
): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse();
    const code =
      typeof body === 'object' && body !== null
        ? (body as { code?: string }).code
        : undefined;
    const hint = code ? hints[code] : undefined;
    return err(hint ? `${error.message} ${hint}` : error.message);
  }
}
