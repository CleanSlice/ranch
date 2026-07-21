import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  IInstallParamValues,
  IInstallPreview,
  IInstallResult,
  IInstallSecretValues,
  TemplateInstallService,
} from '#templateInstall/domain';

// Re-export the domain types so `templateInstall/Provider.vue` (and any future
// consumer importing from `#templateInstall/stores/templateInstall`) keeps
// working.
export type {
  IInstallManifest,
  IInstallParamValues,
  IInstallPreview,
  IInstallResult,
  IInstallSecretValues,
  IManifestMetadata,
  IManifestParam,
  IManifestSecret,
  IManifestUiHints,
} from '#templateInstall/domain';

const getService = createServiceGetter<TemplateInstallService>(
  '$templateInstallService',
);

// Stateless facade over the install service — no reactive state to hold.
export const useTemplateInstallStore = defineStore('templateInstall', () => {
  function previewFromZip(
    archive: File,
    params: IInstallParamValues,
  ): Promise<IInstallPreview> {
    return getService().previewFromZip(archive, params);
  }

  function installFromZip(
    archive: File,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<IInstallResult> {
    return getService().installFromZip(archive, params, secrets);
  }

  function previewFromGit(
    gitUrl: string,
    gitRef: string | undefined,
    params: IInstallParamValues,
  ): Promise<IInstallPreview> {
    return getService().previewFromGit(gitUrl, gitRef, params);
  }

  function installFromGit(
    gitUrl: string,
    gitRef: string | undefined,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<IInstallResult> {
    return getService().installFromGit(gitUrl, gitRef, params, secrets);
  }

  return {
    previewFromZip,
    installFromZip,
    previewFromGit,
    installFromGit,
  };
});
