import { NotFoundException } from '@nestjs/common';
import { AgentCardService } from './agentCard.service';
import type { IAgentGateway } from '#/agent/agent/domain';
import type { ITemplateGateway } from '#/agent/template/domain';
import type { ISkillGateway } from '#/skill/domain/skill.gateway';
import type { IKnowledgeGateway } from '#/reins/knowledge/domain/knowledge.gateway';
import type { IInfraConfigGateway } from '#/setting/domain/infraConfig.gateway';

/**
 * The card is the unit every other part of A2A exchanges, and it is derived,
 * never stored — so these cases pin the derivation itself: which description
 * wins, which knowledge bases count, what a skill reads like to the agent on
 * the other side, and the one thing that must never appear (peers).
 */
interface HarnessOptions {
  agent?: Record<string, unknown> | null;
  template?: Record<string, unknown> | null;
  skills?: Array<{ id: string; title: string; description: string | null }>;
  bases?: Array<{ id: string; name: string; description: string | null }>;
  apiUrl?: string;
}

function makeHarness(options: HarnessOptions = {}) {
  const agent =
    options.agent === undefined
      ? {
          id: 'agent-1',
          name: 'Support Bot',
          templateId: 'tpl-1',
          knowledgeIds: [] as string[],
          config: {} as Record<string, unknown>,
        }
      : options.agent;

  const template =
    options.template === undefined
      ? {
          id: 'tpl-1',
          description: 'A template for support agents.',
          version: '2',
          skillIds: [] as string[],
          defaultKnowledgeIds: [] as string[],
        }
      : options.template;

  const findByIds = jest.fn(async (ids: string[]) =>
    (options.skills ?? []).filter((s) => ids.includes(s.id)),
  );
  const findExistingByIds = jest.fn(async (ids: string[]) =>
    (options.bases ?? []).filter((b) => ids.includes(b.id)),
  );

  const service = new AgentCardService(
    { findById: jest.fn(async () => agent) } as unknown as IAgentGateway,
    { findById: jest.fn(async () => template) } as unknown as ITemplateGateway,
    { findByIds } as unknown as ISkillGateway,
    { findExistingByIds } as unknown as IKnowledgeGateway,
    {
      getApiPublicUrl: jest.fn(
        async () => options.apiUrl ?? 'https://api.ranch.test',
      ),
    } as unknown as IInfraConfigGateway,
  );

  return { service, findByIds, findExistingByIds };
}

describe('AgentCardService.build', () => {
  it('describes the agent at the address another agent sends tasks to', async () => {
    const { service } = makeHarness();

    const card = await service.build('agent-1');

    expect(card).toMatchObject({
      name: 'Support Bot',
      version: '2',
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      supportedInterfaces: [
        {
          url: 'https://api.ranch.test/a2a/agents/agent-1',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ],
      provider: { organization: 'Ranch', url: 'https://api.ranch.test' },
    });
  });

  it('advertises no streaming, because this server answers one blocking call', async () => {
    const { service } = makeHarness();

    const card = await service.build('agent-1');

    expect(card.capabilities).toMatchObject({
      streaming: false,
      pushNotifications: false,
    });
  });

  it('asks for a peer credential and offers no anonymous route in', async () => {
    const { service } = makeHarness();

    const card = await service.build('agent-1');

    expect(card.securitySchemes).toHaveProperty('peerBearer');
    expect(card.securityRequirements).toHaveLength(1);
  });

  it('turns each template skill into a card skill', async () => {
    const { service } = makeHarness({
      template: {
        id: 'tpl-1',
        description: 'tpl',
        version: '1',
        skillIds: ['s1', 's2'],
        defaultKnowledgeIds: [],
      },
      skills: [
        { id: 's1', title: 'Order lookup', description: 'Finds an order.' },
        { id: 's2', title: 'Refunds', description: null },
      ],
    });

    const card = await service.build('agent-1');

    expect(card.skills).toEqual([
      {
        id: 'skill:s1',
        name: 'Order lookup',
        description: 'Finds an order.',
        tags: ['skill'],
      },
      // No description of its own: the title is a better fallback than an
      // empty string, which would tell the calling agent nothing at all.
      {
        id: 'skill:s2',
        name: 'Refunds',
        description: 'Refunds',
        tags: ['skill'],
      },
    ]);
  });

  it('phrases a knowledge base as what it lets the agent answer', async () => {
    const { service } = makeHarness({
      agent: {
        id: 'agent-1',
        name: 'Support Bot',
        templateId: 'tpl-1',
        knowledgeIds: ['k1', 'k2'],
        config: {},
      },
      bases: [
        { id: 'k1', name: 'Returns policy', description: '2026 policy PDF.' },
        { id: 'k2', name: 'Shipping', description: null },
      ],
    });

    const card = await service.build('agent-1');

    expect(card.skills).toEqual([
      {
        id: 'knowledge:k1',
        name: 'Returns policy',
        description:
          'Answers questions about «Returns policy»: 2026 policy PDF.',
        tags: ['knowledge'],
      },
      {
        id: 'knowledge:k2',
        name: 'Shipping',
        description: 'Answers questions about «Shipping».',
        tags: ['knowledge'],
      },
    ]);
  });

  it('prefers the bases bound to the agent over the template defaults', async () => {
    const { service, findExistingByIds } = makeHarness({
      agent: {
        id: 'agent-1',
        name: 'Support Bot',
        templateId: 'tpl-1',
        knowledgeIds: ['own'],
        config: {},
      },
      template: {
        id: 'tpl-1',
        description: 'tpl',
        version: '1',
        skillIds: [],
        defaultKnowledgeIds: ['from-template'],
      },
      bases: [{ id: 'own', name: 'Own base', description: null }],
    });

    const card = await service.build('agent-1');

    expect(findExistingByIds).toHaveBeenCalledWith(['own']);
    expect(card.skills.map((s) => s.id)).toEqual(['knowledge:own']);
  });

  it('falls back to the template defaults when the agent binds nothing', async () => {
    const { service, findExistingByIds } = makeHarness({
      template: {
        id: 'tpl-1',
        description: 'tpl',
        version: '1',
        skillIds: [],
        defaultKnowledgeIds: ['from-template'],
      },
      bases: [{ id: 'from-template', name: 'Inherited', description: null }],
    });

    const card = await service.build('agent-1');

    expect(findExistingByIds).toHaveBeenCalledWith(['from-template']);
    expect(card.skills.map((s) => s.name)).toEqual(['Inherited']);
  });

  it('drops a binding whose base has been deleted instead of advertising it', async () => {
    const { service } = makeHarness({
      agent: {
        id: 'agent-1',
        name: 'Support Bot',
        templateId: 'tpl-1',
        knowledgeIds: ['alive', 'deleted'],
        config: {},
      },
      bases: [{ id: 'alive', name: 'Alive', description: null }],
    });

    const card = await service.build('agent-1');

    expect(card.skills.map((s) => s.id)).toEqual(['knowledge:alive']);
  });

  it('is a valid card even with nothing to advertise', async () => {
    const { service } = makeHarness();

    const card = await service.build('agent-1');

    expect(card.skills).toEqual([]);
    expect(card.name).toBe('Support Bot');
  });

  it('prefers the agent own description over the template one', async () => {
    const { service } = makeHarness({
      agent: {
        id: 'agent-1',
        name: 'Support Bot',
        templateId: 'tpl-1',
        knowledgeIds: [],
        config: { description: '  Answers order questions.  ' },
      },
    });

    const card = await service.build('agent-1');

    expect(card.description).toBe('Answers order questions.');
  });

  it('falls back to the template description, then to naming the agent', async () => {
    const withTemplate = makeHarness();
    await expect(
      withTemplate.service.build('agent-1').then((c) => c.description),
    ).resolves.toBe('A template for support agents.');

    const withNothing = makeHarness({ template: null });
    await expect(
      withNothing.service.build('agent-1').then((c) => c.description),
    ).resolves.toBe('Ranch agent «Support Bot».');
  });

  it('never mentions the agent own peers', async () => {
    const { service } = makeHarness({
      template: {
        id: 'tpl-1',
        description: 'tpl',
        version: '1',
        skillIds: ['s1'],
        defaultKnowledgeIds: [],
      },
      skills: [{ id: 's1', title: 'Order lookup', description: 'Finds.' }],
    });

    const card = await service.build('agent-1');

    // "peerBearer" is the security scheme and belongs here. What must not
    // exist is any enumeration of who this agent can delegate to: no peers
    // collection, and no skill standing in for one.
    expect(card).not.toHaveProperty('peers');
    expect(card).not.toHaveProperty('peerOf');
    expect(card.skills.every((s) => !s.id.startsWith('peer:'))).toBe(true);
    const skillWords = card.skills.flatMap((skill) =>
      `${skill.name} ${skill.description}`.toLowerCase().split(/[^a-z]+/),
    );
    expect(skillWords).not.toContain('peer');
    expect(skillWords).not.toContain('peers');
  });

  it('builds absolute URLs that survive a trailing slash in the setting', async () => {
    const { service } = makeHarness({ apiUrl: 'https://api.ranch.test' });

    await expect(service.cardUrlFor('agent-1')).resolves.toBe(
      'https://api.ranch.test/a2a/agents/agent-1/.well-known/agent-card.json',
    );
    await expect(service.interfaceUrlFor('agent-1')).resolves.toBe(
      'https://api.ranch.test/a2a/agents/agent-1',
    );
  });

  it('refuses to invent a card for an agent that does not exist', async () => {
    const { service } = makeHarness({ agent: null });

    await expect(service.build('ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
