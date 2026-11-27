import { IFigureDefinition } from '../figure.types';

/**
 * Questions an agent handed over to a peer (`AgentDelegation`, agent/peer
 * slice). Read in place: the audit row is written before the peer is called
 * and finished once, so it is the record of the hand-over and of how it
 * ended. Nothing to rebuild, and no first record: no hand-over before some
 * day means no agent handed anything over before it, so the figure never
 * carries a "counted since" note (CLEAN-262).
 */
export const handoversFigure: IFigureDefinition = {
  key: 'handovers',
  scopes: ['personal'],
};
