import { TemplateFileGateway } from '../data/templateFile.gateway';
import { TemplateFileService } from '../domain/templateFile.service';

/**
 * Composition root for the templateFile slice. Provides `$templateFileService`.
 */
export default defineNuxtPlugin({
  name: 'template-file-di',
  setup() {
    const service = new TemplateFileService(new TemplateFileGateway());
    return {
      provide: {
        templateFileService: service,
      },
    };
  },
});
