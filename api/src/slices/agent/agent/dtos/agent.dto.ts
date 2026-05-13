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

  @ApiProperty({
    type: [String],
    description:
      'Origins (scheme + host + port) authorized to open browser WebSockets to this bot without a JWT. Only consulted when isPublic=true.',
    example: ['https://bridle.cleanslice.org', 'http://localhost:5173'],
  })
  allowedOrigins: string[];

  @ApiProperty({
    description:
      'Messaging channels the runtime should connect to (telegram, …). Each entry is { type, config }; mapped to runtime env vars at deploy time.',
    isArray: true,
    example: [
      { type: 'telegram', config: { botToken: 'xxx', botName: 'mybot' } },
    ],
  })
  channels: unknown[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
