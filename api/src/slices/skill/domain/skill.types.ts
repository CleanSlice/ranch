import type { SkillGroup } from './skill.groups';

export interface ISkillFile {
  /** Path relative to the skill root, e.g. "references/security.md" */
  path: string;
  content: string;
}

/** A template a skill is attached to, as the Skills page shows it. */
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
  /** `files.length`, so the list does not have to carry the contents to count them. */
  filesCount: number;
  source: string | null;
  /** Library group on the admin Skills page, or null (CLEAN-205). */
  group: SkillGroup | null;
  /** Shared display order of the Skills page; no effect on agents or templates. */
  sortOrder: number;
  /** ceil(body.length / 4); the console shows it with "≈". */
  tokenEstimate: number;
  /** Templates that ship this skill — read-only here, managed on the Templates page. */
  templates: ISkillTemplateRef[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateSkillData {
  name: string;
  title: string;
  body: string;
  description?: string | null;
  files?: ISkillFile[];
  source?: string | null;
  group?: SkillGroup | null;
}

export interface IUpdateSkillData {
  name?: string;
  title?: string;
  body?: string;
  description?: string | null;
  files?: ISkillFile[];
  source?: string | null;
  group?: SkillGroup | null;
}

/** One position in the shared library order. */
export interface ISkillOrderItem {
  id: string;
  sortOrder: number;
}

/**
 * The whole library order plus a version: a hash of the positions, so a save
 * made against an order someone else has changed since is refused (409).
 */
export interface ISkillOrder {
  version: string;
  items: ISkillOrderItem[];
}

export interface ISkillDependentAgent {
  id: string;
  name: string;
  status: string;
  templateId: string;
  templateName: string;
}

export interface ISkillSearchHit {
  /** Stable identifier for the result (used for import) */
  source: string; // e.g. "github:anthropics/skills"
  repo: string; // owner/repo
  path: string; // path to SKILL.md within repo
  /** Suggested skill metadata extracted from path/contents */
  name: string; // proposed slug
  title: string;
  description: string | null;
  /** Permalink to view in browser */
  url: string;
  /** Search-engine-provided context, if any */
  snippet: string | null;
}
