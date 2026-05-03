import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IMcpServerGateway } from './mcpServer.gateway';

export const RANCH_MCP_ID = 'mcp-ranch';

@Injectable()
export class McpServerSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(McpServerSeeder.name);

  constructor(
    private gateway: IMcpServerGateway,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const existing = await this.gateway.findById(RANCH_MCP_ID);
    if (existing) return;

    // Default in-cluster URL of the API itself. Operators can override via
    // RANCH_MCP_URL env or by editing the DB record (only enabled/description
    // are editable — url is locked because the api owns this entry).
    const url =
      this.config.get<string>('RANCH_MCP_URL') ?? 'http://api:3001/mcp/mcp';

    await this.gateway.create({
      id: RANCH_MCP_ID,
      name: 'Ranch',
      description:
        "Built-in MCP server hosted by this Ranch's own API. Exposes ranch-management tools (list_agents, restart_agent, write_agent_file, ...). Auth uses the agent's RANCH_API_TOKEN.",
      url,
      transport: 'streamableHttp',
      authType: 'bearer',
      authValue: '${RANCH_API_TOKEN}',
      enabled: true,
      builtIn: true,
    });
    this.logger.log(`Seeded built-in Ranch MCP server at ${url}`);
  }
}
