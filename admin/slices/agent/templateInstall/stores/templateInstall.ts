import { TemplatesService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export interface IManifestUiHints {
  label?: string;
  hint?: string;
  placeholder?: string;
  groupId?: string;
  groupLabel?: string;
  groupHint?: string;
  docsUrl?: string;
}

export interface IManifestParam extends IManifestUiHints {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  values?: string[];
  default?: string | number | boolean;
  description?: string;
  pattern?: string;
  required?: boolean;
}

export interface IManifestSecret extends IManifestUiHints {
  name: string;
  description?: string;
  pattern?: string;
  required?: boolean;
}

export interface IManifestMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  license?: string;
  tags?: string[];
}

// Keep this loose — manifest is opaque from the UI's perspective except
// for the fields we actively render.
export interface IInstallManifest {
  apiVersion: string;
  kind: string;
  metadata: IManifestMetadata;
  params?: IManifestParam[];
  secrets?: IManifestSecret[];
  skills?: { id: string }[];
  mcp?: { id: string }[];
  paddock?: Record<string, unknown>;
  permissions?: { network?: string[]; adminTools?: boolean };
  [key: string]: unknown;
}

export interface IInstallPreview {
  manifest: IInstallManifest;
  willCreate: boolean;
  willUpgrade: boolean;
  existingTemplateId?: string;
  declared: {
    skills: { id: string; resolved: boolean }[];
    mcp: { id: string; resolved: boolean }[];
    secrets: { name: string; required: boolean }[];
  };
  files: { agentFiles: number; scenarioFiles: number };
  warnings: string[];
}

export interface IInstallResult {
  templateId: string;
  templateName: string;
  filesUploaded: number;
  scenariosSeeded: number;
  mcpAttached: string[];
  skillsAttached: string[];
  unresolvedMcp: string[];
  unresolvedSkills: string[];
  warnings: string[];
}

export type IInstallParamValues = Record<string, string | number | boolean>;
export type IInstallSecretValues = Record<string, string>;

export const useTemplateInstallStore = defineStore('templateInstall', () => {
  async function previewFromZip(
    archive: File,
    params: IInstallParamValues,
  ): Promise<IInstallPreview> {
    const fd = new FormData();
    fd.append('archive', archive);
    fd.append('params', JSON.stringify(params));
    const res = await TemplatesService.previewTemplateInstall({
      body: fd as unknown as { archive?: Blob | File; params?: string },
    });
    const env = res.data as ApiEnvelope<IInstallPreview> | undefined;
    if (!env || !env.success) {
      throw new Error(extractError(res) ?? 'Preview failed');
    }
    return env.data;
  }

  async function installFromZip(
    archive: File,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<IInstallResult> {
    const fd = new FormData();
    fd.append('archive', archive);
    fd.append('params', JSON.stringify(params));
    fd.append('secrets', JSON.stringify(secrets));
    const res = await TemplatesService.installTemplate({
      body: fd as unknown as {
        archive?: Blob | File;
        params?: string;
        secrets?: string;
      },
    });
    const env = res.data as ApiEnvelope<IInstallResult> | undefined;
    if (!env || !env.success) {
      throw new Error(extractError(res) ?? 'Install failed');
    }
    return env.data;
  }

  async function previewFromGit(
    gitUrl: string,
    gitRef: string | undefined,
    params: IInstallParamValues,
  ): Promise<IInstallPreview> {
    const res = await TemplatesService.previewTemplateInstallFromGit({
      body: { gitUrl, gitRef, params },
    });
    const env = res.data as ApiEnvelope<IInstallPreview> | undefined;
    if (!env || !env.success) {
      throw new Error(extractError(res) ?? 'Preview failed');
    }
    return env.data;
  }

  async function installFromGit(
    gitUrl: string,
    gitRef: string | undefined,
    params: IInstallParamValues,
    secrets: IInstallSecretValues,
  ): Promise<IInstallResult> {
    const res = await TemplatesService.installTemplateFromGit({
      body: { gitUrl, gitRef, params, secrets },
    });
    const env = res.data as ApiEnvelope<IInstallResult> | undefined;
    if (!env || !env.success) {
      throw new Error(extractError(res) ?? 'Install failed');
    }
    return env.data;
  }

  return {
    previewFromZip,
    installFromZip,
    previewFromGit,
    installFromGit,
  };
});

function extractError(res: { error?: unknown }): string | null {
  const err = res.error as { message?: string } | undefined;
  return err?.message ?? null;
}
