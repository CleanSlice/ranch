// CLEAN-198: an agent lists the documents of the bases it is bound to — by
// name, with a coverage summary — and nothing of any other base. Listed for
// agents only; the operator has `list_knowledge_sources` for the rest.

import { Logger } from '@nestjs/common';
import { Request } from 'express';
import { KnowledgeDocumentsTool } from './knowledgeDocuments.tool';
import { SourceService } from '../source/domain/source.service';
import type { ISourceData, ISourceFilter } from '../source/domain/source.types';
import { IKnowledgeGateway } from './domain/knowledge.gateway';
import { IAgentGateway } from '#/agent/agent/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { IAuthTokenPayload } from '#/user/auth/domain';

type AgentRequest = Request & { user?: IAuthTokenPayload };

function agentRequest(agentId: string | null): AgentRequest {
  return {
    user: agentId ? { sub: `agent:${agentId}` } : { sub: 'user:u1' },
  } as AgentRequest;
}

function source(knowledgeId: string, name: string): ISourceData {
  return {
    id: `src-${name}`,
    knowledgeId,
    name,
    type: 'file',
    url: `s3://bucket/${knowledgeId}/${name}`,
    indexStatus: 'indexed',
  } as ISourceData;
}

const K1_DOCS = [
  source('k1', '2026 CX-5 Spec Deck.md'),
  source('k1', '25MY CX-5 Order Form.md'),
  source('k1', '2021 Mazda6 Order Guide 2020-11-16.md'),
  source('k1', 'Audio_Settings_Guide.md'),
];
const K2_DOCS = [source('k2', 'Grangemouth override codes.md')];

interface Harness {
  tool: KnowledgeDocumentsTool;
  findPage: jest.Mock;
  findByKnowledge: jest.Mock;
}

function makeHarness(boundIds: string[], failWith?: Error): Harness {
  const docsOf = (id: string) =>
    id === 'k1' ? K1_DOCS : id === 'k2' ? K2_DOCS : [];
  const findPage = jest.fn(async (id: string, filter: ISourceFilter) => {
    if (failWith) throw failWith;
    const matching = docsOf(id).filter((s) =>
      filter.search
        ? s.name.toLowerCase().includes(filter.search.toLowerCase())
        : true,
    );
    const start = (filter.page - 1) * filter.perPage;
    return {
      items: matching.slice(start, start + filter.perPage),
      total: matching.length,
      page: filter.page,
      perPage: filter.perPage,
    };
  });
  const findByKnowledge = jest.fn(async (id: string) => {
    if (failWith) throw failWith;
    return docsOf(id);
  });
  const sources = { findPage, findByKnowledge } as unknown as SourceService;

  const agentGateway = {
    findById: jest.fn(async (id: string) =>
      id === 'agent-1'
        ? { id, knowledgeIds: boundIds, templateId: 'tpl-1' }
        : null,
    ),
  } as unknown as IAgentGateway;
  const templateGateway = {
    findById: jest.fn(async () => ({ defaultKnowledgeIds: [] })),
  } as unknown as ITemplateGateway;
  const knowledgeGateway = {
    findExistingByIds: jest.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, name: id === 'k1' ? 'Mazda' : 'Other' })),
    ),
  } as unknown as IKnowledgeGateway;

  return {
    tool: new KnowledgeDocumentsTool(
      sources,
      agentGateway,
      templateGateway,
      knowledgeGateway,
    ),
    findPage,
    findByKnowledge,
  };
}

function parse(result: { content: { text: string }[]; isError?: boolean }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

describe('list_knowledge_documents — who sees it', () => {
  it('is listed for an agent and hidden from a person', async () => {
    const { tool } = makeHarness(['k1']);
    expect(await tool.isListedForRequest(agentRequest('agent-1'))).toBe(true);
    expect(await tool.isListedForRequest(agentRequest(null))).toBe(false);
  });

  it('refuses a caller that is not an agent runtime', async () => {
    const { tool, findPage } = makeHarness(['k1']);
    await expect(
      tool.list({}, undefined, agentRequest(null)),
    ).rejects.toThrow();
    expect(findPage).not.toHaveBeenCalled();
  });
});

describe('list_knowledge_documents — what it lists', () => {
  it('names the documents of the bound base, without ids or storage paths, with the coverage of the whole base', async () => {
    const { tool, findPage } = makeHarness(['k1']);

    const result = parse(
      await tool.list({}, undefined, agentRequest('agent-1')),
    );

    expect(result).toEqual({
      knowledge_id: 'k1',
      knowledge_name: 'Mazda',
      documents: K1_DOCS.map((s) => ({ name: s.name, type: 'file' })),
      total: 4,
      page: 1,
      per_page: 50,
      coverage: {
        documents: 4,
        years: { '2021': 1, '2025': 1, '2026': 1 },
        subjects: [
          { subject: 'CX-5', documents: 2, years: { '2025': 1, '2026': 1 } },
          { subject: 'Mazda6', documents: 1, years: { '2021': 1 } },
        ],
        undated: 1,
      },
    });
    expect(JSON.stringify(result)).not.toContain('s3://');
    expect(JSON.stringify(result)).not.toContain('src-');
    expect(findPage).toHaveBeenCalledWith('k1', {
      page: 1,
      perPage: 50,
      search: undefined,
      sort: 'createdAt',
      order: 'asc',
    });
  });

  it('searches by name and pages, while the coverage stays that of the whole base', async () => {
    const { tool, findPage } = makeHarness(['k1']);

    const result = parse(
      await tool.list(
        { search: 'cx-5', page: 2, per_page: 1 },
        undefined,
        agentRequest('agent-1'),
      ),
    );

    expect(result.documents).toEqual([
      { name: '25MY CX-5 Order Form.md', type: 'file' },
    ]);
    expect(result).toMatchObject({ total: 2, page: 2, per_page: 1 });
    expect((result.coverage as { documents: number }).documents).toBe(4);
    expect(findPage).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({ search: 'cx-5', page: 2, perPage: 1 }),
    );
  });

  it('answers once per bound base when there are several', async () => {
    const { tool } = makeHarness(['k1', 'k2']);

    const result = parse(
      await tool.list({}, undefined, agentRequest('agent-1')),
    );

    const results = result.results as Array<{ knowledge_id: string }>;
    expect(results.map((r) => r.knowledge_id)).toEqual(['k1', 'k2']);
  });

  it('names a base that could not be listed instead of dropping it', async () => {
    const { tool } = makeHarness(['k1'], new Error('db away'));

    const result = parse(
      await tool.list({}, undefined, agentRequest('agent-1')),
    );

    expect(result).toEqual({
      knowledge_id: 'k1',
      knowledge_name: 'Mazda',
      error: 'Knowledge base Mazda could not be listed: db away',
    });
  });
});

describe('list_knowledge_documents — what it never lists', () => {
  it('reads nothing for an agent with no bound base', async () => {
    const { tool, findPage, findByKnowledge } = makeHarness([]);

    const result = await tool.list({}, undefined, agentRequest('agent-1'));

    expect(result.isError).toBe(true);
    expect(findPage).not.toHaveBeenCalled();
    expect(findByKnowledge).not.toHaveBeenCalled();
  });

  it('refuses a base the agent is not bound to and never reads it', async () => {
    const { tool, findPage, findByKnowledge } = makeHarness(['k1']);

    const result = await tool.list(
      { knowledge_id: 'k2' },
      undefined,
      agentRequest('agent-1'),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not bound');
    expect(result.content[0].text).not.toContain('Grangemouth');
    expect(findPage).not.toHaveBeenCalled();
    expect(findByKnowledge).not.toHaveBeenCalled();
  });

  it('never reads an unbound base even without a knowledge_id', async () => {
    const { tool, findPage, findByKnowledge } = makeHarness(['k1']);

    const result = parse(
      await tool.list({}, undefined, agentRequest('agent-1')),
    );

    expect(JSON.stringify(result)).not.toContain('Grangemouth');
    const readIds = [
      ...(findPage.mock.calls as [string, ISourceFilter][]),
      ...(findByKnowledge.mock.calls as [string][]),
    ].map(([id]) => id);
    expect(readIds).toEqual(['k1', 'k1']);
  });
});
