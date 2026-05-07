export interface ITemplateData {
  id: string;
  name: string;
  description: string;
  image: string;
  defaultConfig: Record<string, unknown>;
  defaultResources: { cpu: string; memory: string };
  // Paddock runtime config — passThreshold, maxIterations, blockedTools, …
  // Populated from .paddock/config.json at install time when present.
  paddockConfig: Record<string, unknown>;
  // Provenance — populated when created via templateInstall.
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
  sourceUrl?: string | null;
  sourceType?: string | null;
  manifestJson?: Record<string, unknown> | null;
  version?: string | null;
}
