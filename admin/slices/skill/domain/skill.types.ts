// Domain types for skills.

export interface ISkillFile {
  path: string;
  content: string;
}

export interface ISkillData {
  id: string;
  name: string;
  title: string;
  description: string | null;
  body: string;
  files: ISkillFile[];
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ISkillInput {
  name: string;
  title: string;
  body: string;
  description?: string;
}

export interface ISkillSearchHit {
  source: string;
  repo: string;
  path: string;
  name: string;
  title: string;
  description: string | null;
  url: string;
  snippet: string | null;
}

export interface ISkillDependentAgent {
  id: string;
  name: string;
  status: string;
  templateId: string;
  templateName: string;
}

export interface ISkillExistsConflict {
  code: 'SKILL_EXISTS';
  message: string;
  existing: {
    id: string;
    name: string;
    title: string;
    description: string | null;
    source: string | null;
    updatedAt: string;
  };
}

export interface IImportFromGithubInput {
  repo: string;
  path: string;
  name?: string;
  overwrite?: boolean;
}

export interface IImportFromUrlInput {
  url: string;
  name?: string;
  overwrite?: boolean;
}
