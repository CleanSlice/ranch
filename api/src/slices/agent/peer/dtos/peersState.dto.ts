import { ApiProperty } from '@nestjs/swagger';

/**
 * Whether the running pod has loaded the agent's current peer set (CLEAN-95).
 * A pod reads its tool list once, at boot; `armed=false` means the peers on
 * screen and the peers the agent can actually ask have drifted apart, and a
 * restart is the one click that reconciles them.
 */
export class PeersStateDto {
  @ApiProperty({
    description:
      "True when the running pod's last-served peer set matches the current " +
      'one — delegation is armed.',
    example: true,
  })
  armed: boolean;

  @ApiProperty({
    description:
      'When the pod last received the peer list over MCP; null if never ' +
      '(agent not restarted since its first peer was connected).',
    format: 'date-time',
    nullable: true,
    type: String,
    example: '2026-09-16T12:00:00.000Z',
  })
  servedAt: string | null;
}
