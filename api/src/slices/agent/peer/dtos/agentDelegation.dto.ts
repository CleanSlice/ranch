import { ApiProperty } from '@nestjs/swagger';

/**
 * One recorded delegation (CLEAN-74, FR-016) — the audit trail that lets an
 * operator see who asked whom, when and how it went without reading chat text.
 */
export class AgentDelegationDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    description:
      'The connection the task went through — the stable per-peer key for ' +
      'both origins; null once that connection was removed (CLEAN-95).',
    nullable: true,
    type: String,
  })
  peerId: string | null;

  @ApiProperty({
    description:
      'The peer agent that was asked, or null when the peer is external ' +
      'to this installation (CLEAN-95).',
    nullable: true,
    type: String,
  })
  peerAgentId: string | null;

  @ApiProperty({ example: 'Support Bot' })
  peerName: string;

  @ApiProperty({
    description: 'The self-contained task the peer received.',
    example: 'What is the return window for shoes?',
  })
  task: string;

  @ApiProperty({
    description: "The calling model's one-line reason for choosing this peer.",
    example: 'Support Bot holds the returns policy base',
  })
  reason: string;

  @ApiProperty({
    description: 'waiting | answered | failed | rejected.',
    example: 'answered',
  })
  status: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Why it did not produce an answer: PEER_NOT_RUNNING, PEER_TIMEOUT, ' +
      'PEER_REJECTED_LOOP, PEER_REJECTED_DEPTH, PEER_UNAUTHORIZED, ' +
      'PEER_UNREACHABLE, PEER_ADDRESS_REFUSED (the card points at a private ' +
      'or local address, so nothing was sent), PEER_UNSUPPORTED (the card ' +
      'offers no JSON-RPC interface on A2A 1.0) or PEER_ERROR. Null while ' +
      'waiting and on success — including an empty reply, which is answered.',
    example: null,
  })
  errorCode: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The first part of the reply, or the cause in product wording.',
    example: 'Shoes can be returned within 30 days…',
  })
  excerpt: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-14T10:00:00.000Z' })
  startedAt: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-09-14T10:00:03.120Z',
  })
  finishedAt: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 3120 })
  durationMs: number | null;
}
