import { KnowledgeGateway } from '../data/knowledge.gateway';
import { KnowledgeService } from '../domain/knowledge.service';

/**
 * Composition root for the reins (knowledge) slice. Provides
 * `$knowledgeService`.
 */
export default defineNuxtPlugin({
  name: 'knowledge-di',
  setup() {
    const service = new KnowledgeService(new KnowledgeGateway());
    return {
      provide: {
        knowledgeService: service,
      },
    };
  },
});
