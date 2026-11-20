import {
  PeerVisibilities,
  peerServes,
  peerVisibility,
  type IPeerViewer,
} from './peerAccess';
import type { IAgentPeerData } from './peer.types';

/**
 * The peers an agent may ask in one turn, as that turn's caller is served
 * them (CLEAN-236). `ask_agent` describes this list to the model and resolves
 * a call against it, and against nothing else: a connection that does not
 * serve the caller is not here, so the model cannot name it, describe it, or
 * be told of it in a refusal.
 */
export interface IRosterEntry {
  row: IAgentPeerData;
  /** The caller is served by the peer without reaching it. */
  masked: boolean;
  /** What the model calls it: the card's name, or `Colleague N` when masked. */
  label: string;
  /** What `ask_agent` takes as `peer`: never the agent id of a masked peer. */
  handle: string;
}

export function rosterFor(
  connections: IAgentPeerData[],
  viewer: IPeerViewer,
): IRosterEntry[] {
  const roster: IRosterEntry[] = [];
  let unnamed = 0;
  for (const row of connections) {
    if (!peerServes(row, viewer)) continue;
    const masked = peerVisibility(row, viewer) === PeerVisibilities.Masked;
    roster.push(
      masked
        ? {
            row,
            masked,
            label: `Colleague ${(unnamed += 1)}`,
            handle: row.id,
          }
        : {
            row,
            masked,
            label: row.cardSnapshot?.name ?? row.peerAgentId ?? row.cardUrl,
            handle: row.peerAgentId ?? row.id,
          },
    );
  }
  return roster;
}

/**
 * By id first, then by name. A masked peer answers to its connection id and
 * to the label it was given, never to the id or the name of the agent behind
 * it: a caller who guesses either learns nothing from the answer.
 */
export function matchRoster(
  roster: IRosterEntry[],
  wanted: string,
): IRosterEntry | null {
  const needle = wanted.trim().toLowerCase();
  if (!needle) return null;

  return (
    roster.find(
      (entry) =>
        entry.row.id.toLowerCase() === needle ||
        (!entry.masked &&
          (entry.row.peerAgentId ?? '').toLowerCase() === needle),
    ) ??
    roster.find((entry) => entry.label.trim().toLowerCase() === needle) ??
    null
  );
}
