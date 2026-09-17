import type { IAgentCard } from './peer.types';

/**
 * The address a card is actually called at (CLEAN-97): its first JSON-RPC
 * interface on A2A 1.0 — the same rule the API applies when it imports a card
 * and when it delegates. Showing the first listed interface instead would put
 * an HTTP+JSON or gRPC address in front of the operator while delegations go
 * somewhere else.
 *
 * Falls back to the first interface for a card that offers no JSON-RPC 1.0
 * at all, so the operator still sees where it lives; the API refuses to
 * import such a card anyway.
 */
export function cardAddress(card: IAgentCard | null | undefined): string | null {
  const interfaces = card?.supportedInterfaces ?? [];
  const jsonRpc = interfaces.find(
    (i) =>
      String(i?.protocolBinding ?? '').toUpperCase() === 'JSONRPC' &&
      i?.protocolVersion === '1.0',
  );
  return jsonRpc?.url ?? interfaces[0]?.url ?? null;
}
