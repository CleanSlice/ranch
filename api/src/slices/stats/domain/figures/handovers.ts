import { IDelegationGateway } from '#/agent/peer/domain/delegation.gateway';
import { IFigureDefinition } from '../figure.types';

/**
 * Questions an agent handed over to a peer (`AgentDelegation`, agent/peer
 * slice). Read in place: the audit row is written before the peer is called
 * and finished once, so it is the record of the hand-over and of how it
 * ended. Nothing to rebuild. Complete from the first hand-over on record.
 */
export function handoversFigure(
  delegations: IDelegationGateway,
): IFigureDefinition {
  return {
    key: 'handovers',
    scopes: ['personal'],
    firstRecord: () => delegations.firstRecordAt(),
  };
}
