import { ApiProperty } from '@nestjs/swagger';
import {
  AgentAccessOutcomeKinds,
  IAgentAccessOutcome,
  IAgentAccessSummary,
  IAgentAccessView,
} from '../domain/agentAccess.types';

const OUTCOME_KINDS: AgentAccessOutcomeKinds[] = [
  'all',
  'all_except',
  'only',
  'none',
];

export class AgentAccessOutcomeDto implements IAgentAccessOutcome {
  @ApiProperty({
    enum: OUTCOME_KINDS,
    enumName: 'AgentAccessOutcomeKinds',
    description:
      '`all`: reaches every agent. `all_except`: every agent except `count` ' +
      'denied. `only`: only the `count` allowed. `none`: limited with no ' +
      'allowed agent left, needs review.',
  })
  kind: AgentAccessOutcomeKinds;

  @ApiProperty({
    description:
      'The entries behind the sentence that the caller may see: denied for ' +
      '`all_except`, allowed for `only`, 0 otherwise.',
  })
  count: number;
}

/** The mark of one account on the user list. */
export class AgentAccessSummaryDto implements IAgentAccessSummary {
  @ApiProperty({ enum: OUTCOME_KINDS, enumName: 'AgentAccessOutcomeKinds' })
  kind: AgentAccessOutcomeKinds;

  @ApiProperty({
    description:
      'True when the account is limited and its last allowed agent is gone: ' +
      'it reaches no agents until somebody edits its access.',
  })
  needsReview: boolean;
}

export class AgentAccessDto implements IAgentAccessView {
  @ApiProperty()
  userId: string;

  @ApiProperty({
    type: [String],
    description: 'Allowed agents, among the ones the caller reaches.',
  })
  allowed: string[];

  @ApiProperty({
    type: [String],
    description: 'Denied agents, among the ones the caller reaches.',
  })
  denied: string[];

  @ApiProperty({ type: AgentAccessOutcomeDto })
  outcome: AgentAccessOutcomeDto;

  @ApiProperty()
  needsReview: boolean;

  @ApiProperty({
    description:
      'True when the account has entries, or reaches agents, that the ' +
      'caller cannot see. No id or name of those is returned.',
  })
  hasEntriesOutsideView: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Send it back with PUT. Null for an account whose access was never ' +
      'edited.',
  })
  version: string | null;
}
