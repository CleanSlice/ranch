export interface ISkillFile {
  /** Path relative to the skill root, e.g. "references/security.md" */
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
}

export interface IUpdateSkillData {
  name?: string;
  title?: string;
  body?: string;
  description?: string | null;
  files?: ISkillFile[];
  source?: string | null;
}

export interface ISkillSearchHit {
  /** Stable identifier for the result (used for import) */
  source: string;            // e.g. "github:anthropics/skills"
  repo: string;              // owner/repo
  path: string;              // path to SKILL.md within repo
  /** Suggested skill metadata extracted from path/contents */
  name: string;              // proposed slug
  title: string;
  description: string | null;
  /** Permalink to view in browser */
  url: string;
  /** Search-engine-provided context, if any */
  snippet: string | null;
}
