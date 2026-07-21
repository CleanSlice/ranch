import type {
  IInstallParamValues,
  IInstallPreview,
  IInstallResult,
  IInstallSecretValues,
} from './templateInstall.types';

/**
 * Contract for installing a template from a ZIP archive or a git repo.
 * Implemented by `TemplateInstallGateway`, which uses raw multipart fetch for
 * the ZIP endpoints (the SDK can't send FormData) and the SDK for git (JSON).
 */
export abstract class ITemplateInstallGateway {
  abstract previewFromZip(
    archive: File,
    params: IInstallParamValues,
  ): Promise<IInstallPreview>;
  abstract installFromZip(
    archive: File,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<IInstallResult>;
  abstract previewFromGit(
    gitUrl: string,
    gitRef: string | undefined,
    params: IInstallParamValues,
  ): Promise<IInstallPreview>;
  abstract installFromGit(
    gitUrl: string,
    gitRef: string | undefined,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<IInstallResult>;
}
