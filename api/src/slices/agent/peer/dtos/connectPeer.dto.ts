import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Body of "connect this agent as a peer" (CLEAN-74). */
export class ConnectPeerDto {
  @ApiProperty({
    description:
      'The agent to connect. Must be another agent of this installation: ' +
      'foreign card URLs are not accepted in this feature, and an agent ' +
      'cannot be its own peer.',
  })
  @IsUUID()
  peerAgentId: string;
}
