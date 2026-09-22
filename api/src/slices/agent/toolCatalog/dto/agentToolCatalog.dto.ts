import { ApiProperty } from '@nestjs/swagger';

/**
 * GET /agents/:id/tools (CLEAN-109). The tools this agent's runtime would
 * receive, grouped for the chat's Tools panel, with a per-tool flag saying
 * whether the running pod already has it. Contract:
 * specs/016-agent-tool-parity/contracts/agent-tools.openapi.yaml.
 */
export class AgentToolEntryDto {
  @ApiProperty({ description: 'Technical MCP tool name.', example: 'register_mcp_server' })
  name: string;

  @ApiProperty({ example: 'Register an MCP server' })
  title: string;

  @ApiProperty({
    description: 'The per-caller description, exactly what the runtime would be given.',
  })
  description: string;

  @ApiProperty({
    description: 'Starter prompt with «…» placeholders.',
    example: 'Register the MCP server at «url» named «name»',
  })
  template: string;

  @ApiProperty({ description: 'The tool removes, revokes or interrupts something and needs confirm: true.' })
  destructive: boolean;

  @ApiProperty({
    nullable: true,
    type: Boolean,
    description:
      'null — no pod runs; false — the running pod did not list this tool (restart needed); true — it did.',
  })
  inPod: boolean | null;
}

export class AgentToolGroupDto {
  @ApiProperty({
    description: 'Topic key (e.g. mcp_servers) or mcp:<serverId> for an external server.',
    example: 'mcp_servers',
  })
  key: string;

  @ApiProperty({ example: 'MCP servers' })
  title: string;

  @ApiProperty({ enum: ['builtin', 'external'] })
  kind: 'builtin' | 'external';

  @ApiProperty({
    required: false,
    description: "External servers only — the server row's description. Never its url or auth value.",
  })
  description?: string;

  @ApiProperty({
    description:
      'builtin — at least one tool has inPod=false; external — the server row changed after the pod started.',
  })
  afterRestart: boolean;

  @ApiProperty({
    type: [AgentToolEntryDto],
    description: 'Empty for external groups; their tools are served by the server itself.',
  })
  tools: AgentToolEntryDto[];
}

export class AgentToolCatalogDto {
  @ApiProperty()
  agentId: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'When the current pod started; null when no pod runs.',
    example: '2026-09-22T10:33:00.000Z',
  })
  podStartedAt: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'When the pod last called tools/list; null if it never did.',
    example: '2026-09-22T10:33:05.000Z',
  })
  listedAt: string | null;

  @ApiProperty({ type: [AgentToolGroupDto] })
  groups: AgentToolGroupDto[];
}
