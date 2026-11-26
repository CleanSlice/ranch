import { AgentLimitService } from '#/agent/limit/domain';
import { IFigureDefinition } from '../figure.types';

/**
 * Requests refused by limits, by day (`AgentLoadDay`, agent/limit slice).
 *
 * The day rows start where the minute rows still reached when this release
 * first booted: the limit service rebuilds those days in its `onModuleInit`,
 * which Nest finishes before the registry asks here. On a fresh installation
 * there is no row yet and the figure is complete from now.
 */
export function refusalsFigure(limits: AgentLimitService): IFigureDefinition {
  return {
    key: 'refusals',
    scopes: ['installation'],
    firstRecord: () => limits.firstLoadDayAt(),
    rebuild: 'agentLimit.rebuildMissingDays',
  };
}
