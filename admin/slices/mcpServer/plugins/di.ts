import { McpServerGateway } from '../data/mcpServer.gateway';
import { McpServerService } from '../domain/mcpServer.service';

/**
 * Composition root for the mcpServer slice. Provides `$mcpServerService`.
 */
export default defineNuxtPlugin({
  name: 'mcp-server-di',
  setup() {
    const service = new McpServerService(new McpServerGateway());
    return {
      provide: {
        mcpServerService: service,
      },
    };
  },
});
