import {
  AgentEventOutcomeTypes,
  AgentEventStatusTypes,
  AgentEventWitnessTypes,
} from './agentEvent.types';

/**
 * What to do with an event, before any incident is touched. 'incident' means
 * "open one or join the open one" — which of the two is decided by the
 * database, not here (see AgentIncidentService.attachFailure).
 */
export type EventDispositionTypes =
  | Exclude<AgentEventOutcomeTypes, 'opened' | 'joined'>
  | 'incident';

export interface IDispositionInput {
  status: AgentEventStatusTypes;
  witness: AgentEventWitnessTypes;
  agentFound: boolean;
  // What Ranch holds for the agent right now; null when there is no agent.
  ranchStatus: string | null;
}

/**
 * The rule, in order:
 *
 * 1. No such agent → `unmatched`. Stored, never notified.
 * 2. A `recovered` report → `evidence`. An incident closes when Ranch itself
 *    has seen the agent running for ten quiet minutes, not on a sender's word.
 * 3. A failure Ranch witnessed itself → `incident`. Its own transitions to
 *    'failed' / 'unreachable' are already filtered for restarts and stops.
 * 4. An outside failure while a person stopped the agent → `suppressed_stopped`.
 * 5. An outside failure while the agent is being started or restarted →
 *    `suppressed_starting`. An outside sender sees the old pod of every
 *    restart die exactly as it sees a crash; Ranch's own startup timeout
 *    reports a start that really fails.
 * 6. Otherwise (Ranch holds 'running', 'unreachable' or 'failed') → `incident`.
 */
export function decideDisposition(
  input: IDispositionInput,
): EventDispositionTypes {
  if (!input.agentFound) return 'unmatched';
  if (input.status === 'recovered') return 'evidence';
  if (input.witness === 'ranch') return 'incident';
  if (input.ranchStatus === 'stopped') return 'suppressed_stopped';
  if (input.ranchStatus === 'pending' || input.ranchStatus === 'deploying') {
    return 'suppressed_starting';
  }
  return 'incident';
}
