import { Injectable, NotFoundException } from '@nestjs/common';
import { IAgentGateway } from '#/agent/agent/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { ISkillGateway } from '#/skill/domain/skill.gateway';
import { IKnowledgeGateway } from '#/reins/knowledge/domain/knowledge.gateway';
import { IInfraConfigGateway } from '#/setting/domain/infraConfig.gateway';
import {
  A2A_CARD_PATH,
  A2A_VERSION,
  type IA2aAgentCard,
  type IA2aAgentSkill,
} from './a2a.types';

/**
 * Builds an agent's A2A card (CLEAN-74) from what the agent already is: its
 * name and description, the skills of its template, and the knowledge bases
 * bound to it. Nothing is stored — a card is rebuilt on every read, so an
 * operator who edits a description or binds a base sees the change without a
 * "regenerate" button existing at all (FR-001).
 *
 * What the card must NOT contain is as load-bearing as what it does: an
 * agent's own peers never appear (FR-019). Advertising colleagues invites a
 * caller to reason about a chain it cannot see the end of.
 */
@Injectable()
export class AgentCardService {
  constructor(
    private readonly agents: IAgentGateway,
    private readonly templates: ITemplateGateway,
    private readonly skills: ISkillGateway,
    private readonly knowledge: IKnowledgeGateway,
    private readonly infra: IInfraConfigGateway,
  ) {}

  /** Where another agent sends tasks for this one. */
  async interfaceUrlFor(agentId: string): Promise<string> {
    const base = await this.infra.getApiPublicUrl();
    return `${base}/a2a/agents/${agentId}`;
  }

  /** Where another agent reads this one's card — the spec's well-known path. */
  async cardUrlFor(agentId: string): Promise<string> {
    const url = await this.interfaceUrlFor(agentId);
    return `${url}/${A2A_CARD_PATH}`;
  }

  /** This installation's own A2A prefix. An "external" import pointing here
   *  is an internal agent in disguise and must be refused (CLEAN-95). */
  async ownA2aBase(): Promise<string> {
    const base = await this.infra.getApiPublicUrl();
    return `${base}/a2a/agents/`;
  }

  async build(agentId: string): Promise<IA2aAgentCard> {
    const agent = await this.agents.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const template = await this.templates.findById(agent.templateId);

    const [skills, url] = await Promise.all([
      this.buildSkills(
        agent.knowledgeIds,
        template?.skillIds ?? [],
        template?.defaultKnowledgeIds ?? [],
      ),
      this.interfaceUrlFor(agentId),
    ]);

    const apiUrl = url.slice(0, url.indexOf('/a2a/agents/'));

    return {
      name: agent.name,
      description: this.describe(
        agent.name,
        agent.config,
        template?.description,
      ),
      version: template?.version ?? '1',
      supportedInterfaces: [
        { url, protocolBinding: 'JSONRPC', protocolVersion: A2A_VERSION },
      ],
      capabilities: {
        // This server answers one blocking SendMessage at a time. Saying so is
        // the point of the field: a caller that believes in streaming here
        // would wait for events that never arrive.
        streaming: false,
        pushNotifications: false,
        extensions: [],
      },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills,
      securitySchemes: {
        peerBearer: { httpAuthSecurityScheme: { scheme: 'bearer' } },
      },
      securityRequirements: [{ schemes: { peerBearer: { list: [] } } }],
      provider: { organization: 'Ranch', url: apiUrl },
    };
  }

  /**
   * An agent's description is optional in Ranch but required on a card, and an
   * empty one is worse than a plain one: it is the single line another agent
   * reads to decide whether to ask. Falls back to the template, then to a
   * sentence that at least names the agent.
   */
  private describe(
    name: string,
    config: Record<string, unknown>,
    templateDescription?: string,
  ): string {
    const own = config?.description;
    if (typeof own === 'string' && own.trim()) return own.trim();
    if (templateDescription?.trim()) return templateDescription.trim();
    return `Ranch agent «${name}».`;
  }

  /**
   * Two sources, one list. Template skills carry their own descriptions; a
   * knowledge base becomes a skill phrased as what it lets the agent answer,
   * because "Returns policy" alone does not tell a caller when to ask.
   *
   * Effective bases follow the same rule as everywhere else in Ranch: the
   * agent's own binding wins, the template's defaults apply otherwise, and
   * ids of deleted bases are dropped rather than advertised.
   */
  private async buildSkills(
    agentKnowledgeIds: string[],
    templateSkillIds: string[],
    templateKnowledgeIds: string[],
  ): Promise<IA2aAgentSkill[]> {
    const knowledgeIds = agentKnowledgeIds.length
      ? agentKnowledgeIds
      : templateKnowledgeIds;

    const [skillRecords, baseRecords] = await Promise.all([
      templateSkillIds.length
        ? this.skills.findByIds(templateSkillIds)
        : Promise.resolve([]),
      knowledgeIds.length
        ? this.knowledge.findExistingByIds(knowledgeIds)
        : Promise.resolve([]),
    ]);

    const fromSkills: IA2aAgentSkill[] = skillRecords.map((skill) => ({
      id: `skill:${skill.id}`,
      name: skill.title,
      description: skill.description?.trim() || skill.title,
      tags: ['skill'],
    }));

    const fromBases: IA2aAgentSkill[] = baseRecords.map((base) => {
      const detail = base.description?.trim();
      return {
        id: `knowledge:${base.id}`,
        name: base.name,
        description: detail
          ? `Answers questions about «${base.name}»: ${detail}`
          : `Answers questions about «${base.name}».`,
        tags: ['knowledge'],
      };
    });

    return [...fromSkills, ...fromBases];
  }
}
