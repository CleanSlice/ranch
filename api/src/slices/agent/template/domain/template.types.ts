export interface ITemplateData {
  id: string;
  name: string;
  description: string;
  image: string;
  defaultConfig: Record<string, unknown>;
  defaultResources: { cpu: string; memory: string };
  paddockConfig: Record<string, unknown>;
  defaultKnowledgeIds: string[];
  sourceUrl: string | null;
  sourceType: string | null;
  manifestJson: Record<string, unknown> | null;
  version: string | null;
  skillIds: string[];
  mcpServerIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateTemplateData {
  name: string;
  description: string;
  image: string;
  defaultConfig?: Record<string, unknown>;
  defaultResources?: { cpu: string; memory: string };
  paddockConfig?: Record<string, unknown>;
  defaultKnowledgeIds?: string[];
  sourceUrl?: string;
  sourceType?: string;
  manifestJson?: Record<string, unknown>;
  version?: string;
}

export interface IUpdateTemplateData {
  name?: string;
  description?: string;
  image?: string;
  defaultConfig?: Record<string, unknown>;
  defaultResources?: { cpu: string; memory: string };
  paddockConfig?: Record<string, unknown>;
  defaultKnowledgeIds?: string[];
  sourceUrl?: string | null;
  sourceType?: string | null;
  manifestJson?: Record<string, unknown> | null;
  version?: string | null;
}
