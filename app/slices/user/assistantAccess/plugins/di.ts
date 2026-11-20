import { AssistantAccessGateway } from '../data/assistantAccess.gateway';
import { AssistantAccessService } from '../domain/assistantAccess.service';

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
