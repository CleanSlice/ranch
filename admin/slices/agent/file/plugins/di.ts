import { AgentFileGateway } from '../data/agentFile.gateway';
import { AgentFileService } from '../domain/agentFile.service';

/**
 * Composition root for the agentFile slice. Provides `$agentFileService`.
 */
export default defineNuxtPlugin({
  name: 'agent-file-di',
  setup() {
    const service = new AgentFileService(new AgentFileGateway());
    return {
      provide: {
        agentFileService: service,
      },
    };
  },
});
