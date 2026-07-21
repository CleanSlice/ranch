import { TemplatesService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { ITemplateInstallGateway } from '../domain/templateInstall.gateway';
import type {
  IInstallParamValues,
  IInstallPreview,
  IInstallResult,
  IInstallSecretValues,
} from '../domain/templateInstall.types';
import { TemplateInstallMapper } from './templateInstall.mapper';

function extractError(res: { error?: unknown }): string | null {
  const err = res.error as { message?: string } | undefined;
  return err?.message ?? null;
}

export class TemplateInstallGateway
  extends BaseGateway
  implements ITemplateInstallGateway
{
  private mapper = new TemplateInstallMapper();

  previewFromZip(
    archive: File,
    params: IInstallParamValues,
  ): Promise<IInstallPreview> {
    return this.execute(async () => {
      const raw = await this.postMultipart(
        '/templates/install/preview',
        archive,
        params,
        {},
      );
      const preview = this.mapper.toPreview(raw);
      if (!preview) throw new Error('Preview failed');
      return preview;
    });
  }

  installFromZip(
    archive: File,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<IInstallResult> {
    return this.execute(async () => {
      const raw = await this.postMultipart(
        '/templates/install',
        archive,
        params,
        secrets,
      );
      const result = this.mapper.toResult(raw);
      if (!result) throw new Error('Install failed');
      return result;
    });
  }

  previewFromGit(
    gitUrl: string,
    gitRef: string | undefined,
    params: IInstallParamValues,
  ): Promise<IInstallPreview> {
    return this.execute(async () => {
      const res = await TemplatesService.previewTemplateInstallFromGit({
        body: { gitUrl, gitRef, params },
      });
      const preview = this.mapper.toPreview(unwrapEnvelope(res.data));
      if (!preview) throw new Error(extractError(res) ?? 'Preview failed');
      return preview;
    });
  }

  installFromGit(
    gitUrl: string,
    gitRef: string | undefined,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<IInstallResult> {
    return this.execute(async () => {
      const res = await TemplatesService.installTemplateFromGit({
        body: { gitUrl, gitRef, params, secrets },
      });
      const result = this.mapper.toResult(unwrapEnvelope(res.data));
      if (!result) throw new Error(extractError(res) ?? 'Install failed');
      return result;
    });
  }

  // The SDK JSON-serializes bodies, which drops the file — use direct multipart
  // fetch for the two archive endpoints. Returns the unwrapped payload or throws
  // the API's message.
  private async postMultipart(
    path: string,
    archive: File,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<unknown> {
    const runtime = useRuntimeConfig();
    const fd = new FormData();
    fd.append('archive', archive);
    fd.append('params', JSON.stringify(params));
    fd.append('secrets', JSON.stringify(secrets));
    const res = await fetch(`${runtime.public.apiUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: unknown; error?: string; message?: string }
      | null;
    if (!res.ok || !json || json.error) {
      const msg =
        json && typeof json.message === 'string'
          ? json.message
          : `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    if (json.success === false) throw new Error('Request failed');
    return json.data;
  }
}
