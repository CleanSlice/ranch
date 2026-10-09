import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import type { ITemplateGateway } from '#/agent/template/domain';

/**
 * The knowledge bases an agent may read: its own binding, or its template's
 * defaults when it has none of its own. One rule, used by `query_knowledge`
 * to decide what to search and by the chat's citation record to decide what
 * a cited source may link to (CLEAN-138) — a runtime naming a document from
 * a base its agent was never given must not make that document openable.
 */
export async function boundKnowledgeIds(
  agentId: string,
  agents: Pick<IAgentGateway, 'findById'>,
  templates: Pick<ITemplateGateway, 'findById'>,
): Promise<string[]> {
  const agent = await agents.findById(agentId);
  if (!agent) return [];
  if (agent.knowledgeIds.length > 0) return agent.knowledgeIds;
  const template = await templates.findById(agent.templateId);
  return template?.defaultKnowledgeIds ?? [];
}
