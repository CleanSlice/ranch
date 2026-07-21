import type { ITemplateInstallGateway } from './templateInstall.gateway';
import type {
  IInstallParamValues,
  IInstallPreview,
  IInstallResult,
  IInstallSecretValues,
} from './templateInstall.types';

/**
 * Domain service for template installation. Stateless — the store is a thin
 * facade over these use-cases.
 */
export class TemplateInstallService {
  constructor(private gateway: ITemplateInstallGateway) {}

  previewFromZip(
    archive: File,
    params: IInstallParamValues,
  ): Promise<IInstallPreview> {
    return this.gateway.previewFromZip(archive, params);
  }

  installFromZip(
    archive: File,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<IInstallResult> {
    return this.gateway.installFromZip(archive, params, secrets);
  }

  previewFromGit(
    gitUrl: string,
    gitRef: string | undefined,
    params: IInstallParamValues,
  ): Promise<IInstallPreview> {
    return this.gateway.previewFromGit(gitUrl, gitRef, params);
  }

  installFromGit(
    gitUrl: string,
    gitRef: string | undefined,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<IInstallResult> {
    return this.gateway.installFromGit(gitUrl, gitRef, params, secrets);
  }
}
