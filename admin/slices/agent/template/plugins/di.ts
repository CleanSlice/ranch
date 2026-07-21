import { TemplateGateway } from '../data/template.gateway';
import { TemplateService } from '../domain/template.service';

/**
 * Composition root for the template slice. Provides `$templateService`.
 */
export default defineNuxtPlugin({
  name: 'template-di',
  setup() {
    const service = new TemplateService(new TemplateGateway());
    return {
      provide: {
        templateService: service,
      },
    };
  },
});
