// Domain types for the agent slice. Envelope-free; the data layer maps the
// SDK's (loosely-typed `unknown`) responses onto these and converts domain
// input payloads to the wire DTOs.

export interface IAgentData {
  id: string;
  name: string;
  status: string;
  templateId: string;
  workflowId: string | null;
  config: Record<string, unknown>;
  resources: { cpu: string; memory: string };
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload to create an agent. Mirrors the fields the app sends; the mapper
 *  converts it to the generated `CreateAgentDto`. */
export interface IAgentCreateInput {
  name: string;
  templateId: string;
  llmCredentialId?: string;
  config?: Record<string, unknown>;
  resources?: { cpu: string; memory: string };
  isPublic?: boolean;
  allowedOrigins?: string[];
  knowledgeIds?: string[];
  isAdmin?: boolean;
}

/** Payload to update an agent — every create field optional, plus debug. */
export interface IAgentUpdateInput extends Partial<IAgentCreateInput> {
  debugEnabled?: boolean;
}
