import { LlmGateway } from '../data/llm.gateway';
import { LlmService } from '../domain/llm.service';

/**
 * Composition root for the llm slice. Provides `$llmService`.
 */
export default defineNuxtPlugin({
  name: 'llm-di',
  setup() {
    const service = new LlmService(new LlmGateway());
    return {
      provide: {
        llmService: service,
      },
    };
  },
});
