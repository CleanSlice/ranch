import { ApiProperty } from '@nestjs/swagger';

/** An agent offered in the "add peer" picker (CLEAN-74). */
export class AgentPeerCandidateDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Support Bot' })
  name: string;

  @ApiProperty({ description: 'Live agent status.', example: 'running' })
  status: string;

  @ApiProperty({
    description:
      'True when this agent is already a peer — shown as connected rather ' +
      'than offered again.',
    example: false,
  })
  connected: boolean;
}
