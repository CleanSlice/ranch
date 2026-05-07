// Manifest mirrors agent-templates SPEC.md v1.
// Fields are optional only when SPEC marks them optional;
// validation in `manifest.gateway.ts` enforces presence.

export interface IManifestI18nText {
  name?: string;
  description?: string;
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
  // Optional localised name/description per locale code (ISO 639-1).
  i18n?: Record<string, IManifestI18nText>;
}

export interface IManifestRequirements {
  ranchRuntime?: string;
  ranch?: string;
  // Optional fail-fast lists. v1 is informational — no runtime enforcement yet.
  services?: string[];
  env?: string[];
}

export interface IManifestFiles {
  agent: string;
  paddock?: string;
}

export interface IManifestSkillRef {
  id: string;
  source?: string;
}

export interface IManifestMcpRef {
  id: string;
  source?: string;
  config?: Record<string, unknown>;
}

export type ManifestParamType = 'string' | 'number' | 'boolean' | 'enum';

// Optional UI hints — installer wizard renders proper grouped forms.
// Authors can omit all of them; installer falls back to `name` as label.
export interface IManifestUiHints {
  groupId?: string;
  groupLabel?: string;
  groupHint?: string;
  label?: string;
  hint?: string;
  placeholder?: string;
  docsUrl?: string;
}

export interface IManifestParam extends IManifestUiHints {
  name: string;
  type: ManifestParamType;
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

export interface IManifestPaddock {
  seedScenarios?: boolean;
  runOnInstall?: boolean;
  // Manifest-level override of .paddock/config.json's passThreshold.
  // Manifest wins when both are present (it's the version-bound contract).
  passThreshold?: number;
  requiredFor?: {
    // Block install if smoke run is below threshold (requires runOnInstall: true).
    install?: boolean;
    // Block marketplace publish if eval is below threshold (publisher CI gate).
    publish?: boolean;
  };
}

export interface IManifestPermissions {
  network?: string[];
  adminTools?: boolean;
}

export interface IManifestCompliance {
  // Forward-compatible slot — v1 is informational only.
  // Runtime will gain enforcement when compliance machinery lands.
  packs?: string[];
}

export interface IManifest {
  apiVersion: 'ranch/v1';
  kind: 'AgentTemplate';
  metadata: IManifestMetadata;
  requirements?: IManifestRequirements;
  files: IManifestFiles;
  skills?: IManifestSkillRef[];
  mcp?: IManifestMcpRef[];
  params?: IManifestParam[];
  secrets?: IManifestSecret[];
  paddock?: IManifestPaddock;
  permissions?: IManifestPermissions;
  compliance?: IManifestCompliance;
}

// Map of param name → value supplied by the operator at install time.
// Values are constrained to scalars to match ManifestParam types.
export type IInstallParamValues = Record<string, string | number | boolean>;

export interface IExtractedArchive {
  // Absolute path to the directory holding the extracted contents.
  rootDir: string;
  // Cleanup callback — caller must invoke (try/finally) regardless of success.
  cleanup(): Promise<void>;
}

export interface IInstallPreview {
  manifest: IManifest;
  willCreate: boolean;
  willUpgrade: boolean;
  existingTemplateId?: string;
  declared: {
    skills: { id: string; resolved: boolean }[];
    mcp: { id: string; resolved: boolean }[];
    secrets: { name: string; required: boolean }[];
  };
  files: {
    agentFiles: number;
    scenarioFiles: number;
  };
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
