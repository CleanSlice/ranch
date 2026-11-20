import { ApiProperty } from '@nestjs/swagger';
import { AgentCardDto } from './agentCard.dto';

/** A person named on a connection: who made it, or the one person it serves. */
export class PeerPersonDto {
  @ApiProperty({ example: 'user-6f1c…' })
  id: string;

  @ApiProperty({
    description: 'Null once the account no longer exists.',
    nullable: true,
    type: String,
    example: 'Ada Lovelace',
  })
  name: string | null;
}

/**
 * One directed peer connection as the console sees it (CLEAN-74).
 *
 * Response-only, and deliberately without the pair credential: it exists so
 * the API can present it to the peer, and a secret that reaches a browser is a
 * secret that has left the building. `peer.service.spec` asserts its absence.
 */
export class AgentPeerDto {
  @ApiProperty({ description: 'Id of the connection, not of either agent.' })
  id: string;

  @ApiProperty({ description: 'The agent that holds the card (the caller).' })
  agentId: string;

  @ApiProperty({
    description:
      'The agent whose card is held (the peer), or null when the peer was ' +
      'imported from outside this installation.',
    nullable: true,
    type: String,
  })
  peerAgentId: string | null;

  @ApiProperty({
    description:
      "Where this connection points: 'internal' (another agent of this " +
      "installation) or 'external' (imported by card URL, CLEAN-95).",
    enum: ['internal', 'external'],
    example: 'internal',
  })
  origin: 'internal' | 'external';

  @ApiProperty({
    description:
      "The peer's current name. Falls back to the name on the stored card " +
      'when the agent itself is gone.',
    example: 'Support Bot',
  })
  peerName: string;

  @ApiProperty({
    description:
      "The peer's live agent status. 'running' means a delegation can " +
      'succeed right now; anything else means it would fail fast.',
    example: 'running',
  })
  peerStatus: string;

  @ApiProperty({
    description:
      'False when the peer agent no longer exists in this installation.',
    example: true,
  })
  peerExists: boolean;

  @ApiProperty({
    type: AgentCardDto,
    description:
      'The card as read at connect time or at the last refresh — NOT a live ' +
      'read. The delegating agent reasons from this snapshot, so a peer ' +
      'editing its description mid-turn cannot change behaviour until ' +
      'someone presses Refresh.',
  })
  card: AgentCardDto;

  @ApiProperty({
    description: 'Where the snapshot was read from.',
    example:
      'https://api.ranch.example/a2a/agents/6f1c…/.well-known/agent-card.json',
  })
  cardUrl: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the snapshot was taken.',
    example: '2026-09-14T10:00:00.000Z',
  })
  cardReadAt: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-14T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({
    description:
      "How the caller is shown this connection (CLEAN-236). 'full': as it " +
      "is. 'masked': the peer serves the caller through a connection open " +
      'to visitors, and the caller has no access to the peer itself, so ' +
      '`peerName` is a constant, `peerAgentId` is null, `cardUrl` is empty ' +
      'and `card` holds the skills only. A connection the caller may not ' +
      'see at all is not in the list.',
    enum: ['full', 'masked'],
    example: 'full',
  })
  visibility: 'full' | 'masked';

  @ApiProperty({
    description:
      'Who made the connection. Null when it was made before that was ' +
      'recorded, and on a masked row.',
    nullable: true,
    type: PeerPersonDto,
  })
  createdBy: PeerPersonDto | null;

  @ApiProperty({
    description:
      'Internal peers only. False: the peer serves the people who have ' +
      'access to it. True: it serves everybody who talks to the agent, ' +
      'visitors included.',
    example: false,
  })
  openToVisitors: boolean;

  @ApiProperty({
    description:
      'External peers only: the one person this connection serves, when ' +
      'somebody who does not manage the agent added it. Null: it serves ' +
      'everybody who talks to the agent.',
    nullable: true,
    type: PeerPersonDto,
  })
  owner: PeerPersonDto | null;

  @ApiProperty({
    description:
      'The connection existed before access to peers was checked and its ' +
      'visitors setting has not been saved since. Saving it, either way, ' +
      'clears the mark.',
    example: false,
  })
  needsReview: boolean;

  @ApiProperty({
    description: 'The caller may remove this connection.',
    example: true,
  })
  canRemove: boolean;

  @ApiProperty({
    description:
      'The caller manages both agents and may open or close the connection ' +
      'to visitors.',
    example: false,
  })
  canSetVisitors: boolean;
}
