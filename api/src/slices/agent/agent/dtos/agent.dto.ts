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

  @ApiProperty({
    enum: ['pending', 'deploying', 'running', 'failed', 'stopped'],
  })
  status: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Human-readable reason accompanying status=\'failed\' (e.g. "startup did not produce a running agent within 5 minutes", "ImagePullBackOff"). Null for all other statuses and for failures recorded before this field existed.',
  })
  statusReason: string | null;

  @ApiProperty({ nullable: true })
  workflowId: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'When this agent was first successfully deployed. Null ⇒ the agent has never been deployed.',
  })
  firstDeployedAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'When the current/last deploy was started. Anchor of the server-side deploy grace window.',
  })
  lastDeployStartedAt: Date | null;

  @ApiProperty({
    nullable: true,
    enum: ['initial', 'restart'],
    description:
      "Why the current/last deploy ran: 'initial' = first-ever start, 'restart' = any subsequent deploy (restart, start after stop, config-change redeploy). Null only for agents never deployed since this field existed.",
  })
  launchContext: 'initial' | 'restart' | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'When the running pod last pulled its working copy of the agent files ' +
      'from S3 (recorded at runtime boot). Null ⇒ agent not restarted since ' +
      'this field shipped. Files-tab freshness hint + sync-conflict baseline.',
  })
  lastPullAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'When the last successful Sync push completed. Null ⇒ never synced ' +
      'since this field shipped.',
  })
  lastSyncAt: Date | null;

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

  @ApiProperty({ type: [String] })
  knowledgeIds: string[];

  @ApiProperty()
  isAdmin: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
