import { ApiKeyGateway } from '../data/apiKey.gateway';
import { ApiKeyService } from '../domain/apiKey.service';

/**
 * Composition root for the apiKey slice. Provides `$apiKeyService`.
 */
export default defineNuxtPlugin({
  name: 'api-key-di',
  setup() {
    const service = new ApiKeyService(new ApiKeyGateway());
    return {
      provide: {
        apiKeyService: service,
      },
    };
  },
});
