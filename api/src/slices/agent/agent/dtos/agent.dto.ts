import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AgentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  templateId: string;

  @ApiPropertyOptional({ nullable: true })
  llmCredentialId: string | null;

  @ApiProperty()
  status: string;

  @ApiProperty({ nullable: true })
  workflowId: string | null;

  @ApiProperty()
  config: Record<string, unknown>;

  @ApiProperty()
  resources: { cpu: string; memory: string };

  @ApiProperty({
    description:
      'When true, the agent runtime emits prompt-debug snapshots to admin clients via the bridle hub.',
  })
  debugEnabled: boolean;

  @ApiProperty({
    description:
      'When true, the agent is visible on the public landing page to unauthenticated visitors.',
  })
  isPublic: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
