// Domain types for agent templates.

export interface ITemplateResources {
  cpu: string;
  memory: string;
}

export interface ITemplateData {
  id: string;
  name: string;
  description: string;
  image: string;
  defaultConfig: Record<string, unknown>;
  defaultResources: ITemplateResources;
  defaultKnowledgeIds: string[];
  skillIds: string[];
  mcpServerIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ICreateTemplateData {
  name: string;
  description: string;
  image: string;
  defaultConfig?: Record<string, unknown>;
  defaultResources?: ITemplateResources;
  defaultKnowledgeIds?: string[];
}

export interface IUpdateTemplateData {
  name?: string;
  description?: string;
  image?: string;
  defaultConfig?: Record<string, unknown>;
  defaultResources?: ITemplateResources;
  defaultKnowledgeIds?: string[];
}

/** Result of restarting every agent that uses a template. */
export interface IRestartAgentsResult {
  restarted: number;
  failed: number;
  total: number;
}
