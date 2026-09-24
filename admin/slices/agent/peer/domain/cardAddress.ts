import type { IAgentCard } from './peer.types';

type CardInterface = IAgentCard['supportedInterfaces'][number];

/** Mirrors `selectCallableInterface` in the API: 1.0 first, then the old
 *  dialect, and only then whatever the card happens to list first. */
function callableInterface(
  card: IAgentCard | null | undefined,
): CardInterface | null {
  const interfaces = card?.supportedInterfaces ?? [];
  const jsonRpc = interfaces.filter(
    (i) => String(i?.protocolBinding ?? '').toUpperCase() === 'JSONRPC',
  );
  const modern = jsonRpc.find((i) => i?.protocolVersion === '1.0');
  if (modern) return modern;

  // 0.x, or a card that names no version at all (CLEAN-114).
  const legacy = jsonRpc.find((i) => {
    const version = String(i?.protocolVersion ?? '').trim();
    return version === '' || version.startsWith('0.');
  });
  return legacy ?? interfaces[0] ?? null;
}

/**
 * The address a card is actually called at (CLEAN-97): the JSON-RPC interface
 * the API would dial — the same rule it applies on import and on delegation.
 * Showing the first listed interface instead would put an HTTP+JSON or gRPC
 * address in front of the operator while delegations go somewhere else.
 *
 * Falls back to the first interface for a card the API would refuse anyway,
 * so the operator still sees where it claims to live.
 */
export function cardAddress(card: IAgentCard | null | undefined): string | null {
  return callableInterface(card)?.url ?? null;
}

/**
 * The A2A version that address speaks, when it is not the current one. Ranch
 * talks to 0.x agents in their own dialect (CLEAN-114); the operator should
 * be able to see which of their peers those are, because it explains the
 * differences they will meet later — no streaming, coarser replies.
 */
export function cardLegacyVersion(
  card: IAgentCard | null | undefined,
): string | null {
  const iface = callableInterface(card);
  if (!iface) return null;
  const version = String(iface.protocolVersion ?? '').trim();
  if (version === '1.0') return null;
  return version || '0.3';
}
