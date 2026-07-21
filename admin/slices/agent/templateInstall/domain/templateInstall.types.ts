// Domain types for template installation (from a ZIP archive or a git repo).

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
