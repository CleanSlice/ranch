import { ToolCatalogGateway } from '../data/toolCatalog.gateway';
import { ToolCatalogService } from '../domain/toolCatalog.service';

/**
 * Composition root for the tool catalogue slice (CLEAN-109). Provides
 * `$toolCatalogService`.
 */
export default defineNuxtPlugin({
  name: 'agent-tool-catalog-di',
  setup() {
    const service = new ToolCatalogService(new ToolCatalogGateway());
    return {
      provide: {
        toolCatalogService: service,
      },
    };
  },
});
