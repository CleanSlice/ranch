import { ApiProperty } from '@nestjs/swagger';
import {
  McpServerAuthTypes,
  McpServerTransportTypes,
} from '#/mcpServer/domain';

/**
 * Returned by `GET /agents/:id/mcps` — the list of MCP servers a given agent
 * should connect to at runtime. Trimmed-down view of `IMcpServerData`: drops
 * id, builtIn, timestamps, templateIds — runtime only needs the connection
 * details. The runtime keys MCP entries by `name`, so it MUST be unique here.
 */
export class AgentMcpDto {
  @ApiProperty({ description: 'Unique MCP server name (key in the runtime registry).' })
  name!: string;

  @ApiProperty({
    enum: ['streamableHttp', 'sse'],
    description: 'Transport protocol the runtime should use to connect.',
  })
  transport!: McpServerTransportTypes;

  @ApiProperty({ description: 'MCP server endpoint URL.' })
  url!: string;

  @ApiProperty({
    enum: ['none', 'bearer', 'header'],
    description: 'Auth scheme for the connection.',
  })
  authType!: McpServerAuthTypes;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Auth credential. For `bearer`: raw token (runtime adds the `Bearer ` prefix). For `header`: literal `Header-Name: value` line. `null` when authType is `none`.',
  })
  authValue!: string | null;

  @ApiProperty({
    description:
      'Always `true` in this list — disabled servers are filtered server-side. Kept for forward compatibility.',
  })
  enabled!: boolean;
}
