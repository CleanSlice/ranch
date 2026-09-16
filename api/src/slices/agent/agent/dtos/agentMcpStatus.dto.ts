import { ApiProperty } from '@nestjs/swagger';

/**
 * Whether a running agent still carries the MCP configuration it booted with.
 *
 * The list is baked into pod env at creation, so a change made afterwards
 * only reaches the agent on a restart. Nothing used to report that: a server
 * that is present but unreachable logs `<name>: connect failed`, while one
 * the pod was never told about logs nothing at all — there is no connection
 * to fail (CLEAN-86).
 */
export class AgentMcpStatusDto {
  @ApiProperty({
    description:
      'The pod predates a change to its MCP configuration and needs a restart to pick it up.',
    example: true,
  })
  restartRequired: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Most recent MCP configuration change the pod missed. Null when in sync.',
    example: '2026-09-14T16:00:00.000Z',
  })
  configChangedAt: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'When the current pod started; null when no pod is running, in which case there is nothing to restart.',
    example: '2026-09-14T10:33:00.000Z',
  })
  podStartedAt: string | null;

  @ApiProperty({
    type: [String],
    description: 'Names of the servers that changed after the pod started.',
    example: ['Documents'],
  })
  changedServers: string[];
}
