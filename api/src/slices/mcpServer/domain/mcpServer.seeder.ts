import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IMcpServerGateway } from './mcpServer.gateway';

export const RANCH_MCP_ID = 'mcp-ranch';
export const KNOWLEDGE_MCP_ID = 'mcp-knowledge';
export const CLEANSLICE_MCP_ID = 'mcp-cleanslice';

@Injectable()
export class McpServerSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(McpServerSeeder.name);

  constructor(
    private gateway: IMcpServerGateway,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    // Default in-cluster URL of the API itself. Operators can override via
    // RANCH_MCP_URL env or by editing the DB record (only enabled/description
    // are editable - url is locked because the api owns this entry).
    const url =
      this.config.get<string>('RANCH_MCP_URL') ?? 'http://api:3001/mcp/mcp';

    const existingRanch = await this.gateway.findById(RANCH_MCP_ID);
    if (!existingRanch) {
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

    const existingKnowledge = await this.gateway.findById(KNOWLEDGE_MCP_ID);
    if (!existingKnowledge) {
      await this.gateway.create({
        id: KNOWLEDGE_MCP_ID,
        name: 'Knowledge',
        description:
          "Built-in MCP server hosted by this Ranch's own API. Exposes query_knowledge for knowledge bases bound to the calling agent. Auth uses the agent's RANCH_API_TOKEN.",
        url,
        transport: 'streamableHttp',
        authType: 'bearer',
        authValue: '${RANCH_API_TOKEN}',
        enabled: true,
        builtIn: true,
      });
      this.logger.log(`Seeded built-in Knowledge MCP server at ${url}`);
    }

    const cleansliceUrl =
      this.config.get<string>('CLEANSLICE_MCP_URL') ??
      'https://mcp.cleanslice.org/';

    const existingCleanslice = await this.gateway.findById(CLEANSLICE_MCP_ID);
    if (!existingCleanslice) {
      await this.gateway.create({
        id: CLEANSLICE_MCP_ID,
        name: 'CleanSlice',
        description:
          'Built-in MCP server hosted at mcp.cleanslice.org. Exposes CleanSlice architecture documentation and helpers (get-started, list-categories, search, read-doc). Auto-attached to every agent.',
        url: cleansliceUrl,
        transport: 'streamableHttp',
        authType: 'none',
        authValue: null,
        enabled: true,
        builtIn: true,
      });
      this.logger.log(
        `Seeded built-in CleanSlice MCP server at ${cleansliceUrl}`,
      );
    }
  }
}
