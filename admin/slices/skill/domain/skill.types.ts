// Domain types for skills.
import type { SkillGroup } from './skill.groups';

export type { SkillGroup } from './skill.groups';

export interface ISkillFile {
  path: string;
  content: string;
}

/** A template that ships the skill — read-only on the Skills page. */
export interface ISkillTemplateRef {
  id: string;
  name: string;
}

export interface ISkillData {
  id: string;
  name: string;
  title: string;
  description: string | null;
  body: string;
  files: ISkillFile[];
  filesCount: number;
  source: string | null;
  group: SkillGroup | null;
  /** Shared library order; no effect on agents or templates (CLEAN-205). */
  sortOrder: number;
  /** ceil(body.length / 4), shown as "≈ N tokens". */
  tokenEstimate: number;
  templates: ISkillTemplateRef[];
  createdAt: string;
  updatedAt: string;
}

export interface ISkillInput {
  name: string;
  title: string;
  body: string;
  description?: string;
  group?: SkillGroup | null;
}

export interface ISkillOrderItem {
  id: string;
  sortOrder: number;
}

/** The whole library order with the version a save must send back. */
export interface ISkillOrder {
  version: string;
  items: ISkillOrderItem[];
}

/** Thrown by the gateway when the server answers 409 ORDER_CHANGED. */
export interface ISkillOrderConflict {
  code: 'ORDER_CHANGED';
  message: string;
}

export interface INameAvailability {
  name: string;
  available: boolean;
  existingId?: string;
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
