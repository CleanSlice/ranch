import { AssistantAccessGateway } from '../data/assistantAccess.gateway';
import { AssistantAccessService } from '../domain/assistantAccess.service';

/**
 * Composition root for the assistantAccess slice. Provides
 * `$assistantAccessService`.
 */
export default defineNuxtPlugin({
  name: 'assistant-access-di',
  setup() {
    const service = new AssistantAccessService(new AssistantAccessGateway());
    return {
      provide: {
        assistantAccessService: service,
      },
    };
  },
});
