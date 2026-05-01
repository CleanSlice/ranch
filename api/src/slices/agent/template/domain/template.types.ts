export interface ITemplateData {
  id: string;
  name: string;
  description: string;
  image: string;
  defaultConfig: Record<string, unknown>;
  defaultResources: { cpu: string; memory: string };
  defaultKnowledgeIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateTemplateData {
  name: string;
  description: string;
  image: string;
  defaultConfig?: Record<string, unknown>;
  defaultResources?: { cpu: string; memory: string };
  defaultKnowledgeIds?: string[];
}

export interface IUpdateTemplateData {
  name?: string;
  description?: string;
  image?: string;
  defaultConfig?: Record<string, unknown>;
  defaultResources?: { cpu: string; memory: string };
  defaultKnowledgeIds?: string[];
}
