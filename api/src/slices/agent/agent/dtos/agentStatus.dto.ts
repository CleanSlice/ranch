import { ApiProperty } from '@nestjs/swagger';

export class AgentPodStatusDto {
  @ApiProperty({ example: 'agent-abc-123' })
  agentId: string;

  @ApiProperty({ example: 'agent-agent-abc-123' })
  podName: string;

  @ApiProperty({
    enum: ['Pending', 'Running', 'Succeeded', 'Failed', 'Unknown'],
    example: 'Running',
  })
  phase: string;

  @ApiProperty({ example: true })
  ready: boolean;

  @ApiProperty({ example: 0 })
  restartCount: number;

  @ApiProperty({ nullable: true, type: String, example: '2026-04-30T10:15:00Z' })
  startedAt: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'OOMKilled' })
  lastTerminationReason: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'CrashLoopBackOff' })
  containerWaitingReason: string | null;

  @ApiProperty({ nullable: true, type: String })
  message: string | null;

  @ApiProperty({ example: '2026-04-30T10:30:00Z' })
  observedAt: string;
}

export class AgentStatusDto {
  @ApiProperty({ description: 'Agent DB record (id, name, status, etc.)' })
  agent: Record<string, unknown>;

  @ApiProperty({
    type: AgentPodStatusDto,
    nullable: true,
    description: 'Live pod status; null if no pod is currently running for this agent.',
  })
  pod: AgentPodStatusDto | null;
}
