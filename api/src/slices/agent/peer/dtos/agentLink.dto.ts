import { ApiProperty } from '@nestjs/swagger';

/**
 * One agent-to-agent connection inside this installation, reduced to the two
 * ids (CLEAN-215). It is what a map of the fleet needs to draw who can ask
 * whom, and nothing else: no card, no credential, no URL.
 */
export class AgentLinkDto {
  @ApiProperty({
    description: 'The agent that holds the card: the one that can ask.',
    example: 'agent-3f2a',
  })
  agentId: string;

  @ApiProperty({
    description: 'The agent whose card is held: the one that can be asked.',
    example: 'agent-9c1e',
  })
  peerAgentId: string;
}
