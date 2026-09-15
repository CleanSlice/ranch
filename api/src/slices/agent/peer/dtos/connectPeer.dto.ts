import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/**
 * Body of "connect this agent as a peer" (CLEAN-74).
 *
 * Agent ids are `agent-${uuid}` (see agent.mapper), not bare UUIDs — `@IsUUID()`
 * was rejecting every Connect click with 400 `peerAgentId must be a UUID`.
 */
export class ConnectPeerDto {
  @ApiProperty({
    description:
      'The agent to connect. Must be another agent of this installation: ' +
      'foreign card URLs are not accepted in this feature, and an agent ' +
      'cannot be its own peer. Format: `agent-<uuid>`.',
    example: 'agent-3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  })
  @Matches(/^agent-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
  peerAgentId: string;
}
