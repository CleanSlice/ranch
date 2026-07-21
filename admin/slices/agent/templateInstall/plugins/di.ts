import { TemplateInstallGateway } from '../data/templateInstall.gateway';
import { TemplateInstallService } from '../domain/templateInstall.service';

/**
 * Composition root for the templateInstall slice. Provides
 * `$templateInstallService`.
 */
export default defineNuxtPlugin({
  name: 'template-install-di',
  setup() {
    const service = new TemplateInstallService(new TemplateInstallGateway());
    return {
      provide: {
        templateInstallService: service,
      },
    };
  },
});
