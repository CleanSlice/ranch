import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SourceTool } from './source.tool';
import type { SourceService } from './domain/source.service';
import type { ISourceGateway } from './domain/source.gateway';
import type { IImportJob, ISourceData } from './domain/source.types';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * These tools let an agent decide what other agents answer from. What
 * matters most is therefore that a plain agent cannot see or call them,
 * that a delete names the row and asks before it acts, and that every
 * refusal is a sentence naming the next move.
 */
const source = (overrides: Partial<ISourceData> = {}): ISourceData => ({
  id: 'src-1',
  knowledgeId: 'kb-1',
  type: 'url',
  name: 'Returns policy',
  url: 'https://shop.example/returns',
  mimeType: null,
  content: null,
  sizeBytes: null,
  indexed: false,
  indexStatus: 'pending',
  indexState: 'queued',
  indexError: null,
  indexedAt: null,
  indexAttempts: 0,
  indexRetryAt: null,
  textState: 'none',
  textUrl: null,
  textError: null,
  createdAt: new Date('2026-09-17T10:00:00.000Z'),
  updatedAt: new Date('2026-09-17T10:00:00.000Z'),
  ...overrides,
});

const importJob = (): IImportJob => ({
  id: 'job-1',
  knowledgeId: 'kb-1',
  kind: 'archive',
  status: 'running',
  detected: 12,
  added: 4,
  skipped: 1,
  failed: 0,
  errors: [],
  startedAt: new Date('2026-09-17T10:00:00.000Z'),
  finishedAt: null,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

interface Harness {
  tool: SourceTool;
  service: jest.Mocked<
    Pick<
      SourceService,
      | 'findPage'
      | 'listImports'
      | 'addUrl'
      | 'addText'
      | 'addFromSitemap'
      | 'reindexSource'
      | 'reextractSource'
      | 'delete'
    >
  >;
  gateway: jest.Mocked<Pick<ISourceGateway, 'findById'>>;
}

function harness(): Harness {
  const service = {
    findPage: jest.fn().mockResolvedValue({
      items: [source()],
      total: 1,
      page: 1,
      perPage: 50,
    }),
    listImports: jest.fn().mockReturnValue([importJob()]),
    addUrl: jest.fn().mockResolvedValue(source()),
    addText: jest.fn().mockResolvedValue(
      source({
        id: 'src-2',
        type: 'text',
        name: 'FAQ',
        url: null,
        content: 'Q: … A: …',
      }),
    ),
    addFromSitemap: jest.fn().mockResolvedValue({ added: 3, discovered: 5 }),
    reindexSource: jest.fn().mockResolvedValue(undefined),
    reextractSource: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as Harness['service'];

  const gateway = {
    findById: jest.fn().mockResolvedValue(source()),
  } as unknown as Harness['gateway'];

  const tool = new SourceTool(
    service as unknown as SourceService,
    gateway as unknown as ISourceGateway,
  );
  return { tool, service, gateway };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('SourceTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, service } = harness();
    await expect(
      tool.addKnowledgeSource(
        {
          knowledgeId: 'kb-1',
          kind: 'url',
          name: 'x',
          url: 'https://x.example',
        },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.addUrl).not.toHaveBeenCalled();
  });

  it('refuses a caller with no roles at all', async () => {
    const { tool } = harness();
    await expect(
      tool.listKnowledgeSources({ knowledgeId: 'kb-1' }, null, {} as Request),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SourceTool — reading', () => {
  it('lists a page with the controller defaults', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.listKnowledgeSources(
        { knowledgeId: 'kb-1' },
        null,
        operator(),
      ),
    );
    expect(service.findPage).toHaveBeenCalledWith('kb-1', {
      page: 1,
      perPage: 50,
      search: undefined,
      status: undefined,
      type: undefined,
    });
    expect(text).toContain('Returns policy');
    expect(text).toContain('"total": 1');
  });

  it('passes the filter and paging through', async () => {
    const { tool, service } = harness();
    await tool.listKnowledgeSources(
      {
        knowledgeId: 'kb-1',
        page: 2,
        perPage: 10,
        search: 'return',
        status: 'failed',
        type: 'url',
      },
      null,
      operator(),
    );
    expect(service.findPage).toHaveBeenCalledWith('kb-1', {
      page: 2,
      perPage: 10,
      search: 'return',
      status: 'failed',
      type: 'url',
    });
  });

  it('lists the background imports of a base', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.listKnowledgeImports(
        { knowledgeId: 'kb-1' },
        null,
        operator(),
      ),
    );
    expect(service.listImports).toHaveBeenCalledWith('kb-1');
    expect(text).toContain('job-1');
    expect(text).toContain('"status": "running"');
  });
});

describe('SourceTool — adding', () => {
  it('adds a url source the way the controller does', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.addKnowledgeSource(
        {
          knowledgeId: 'kb-1',
          kind: 'url',
          name: 'Returns policy',
          url: 'https://shop.example/returns',
        },
        null,
        operator(),
      ),
    );
    expect(service.addUrl).toHaveBeenCalledWith('kb-1', {
      name: 'Returns policy',
      url: 'https://shop.example/returns',
    });
    expect(service.addText).not.toHaveBeenCalled();
    expect(text).toContain('src-1');
  });

  it('adds a text source, mapping text to the content field', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.addKnowledgeSource(
        { knowledgeId: 'kb-1', kind: 'text', name: 'FAQ', text: 'Q: … A: …' },
        null,
        operator(),
      ),
    );
    expect(service.addText).toHaveBeenCalledWith('kb-1', {
      name: 'FAQ',
      content: 'Q: … A: …',
    });
    expect(text).toContain('src-2');
  });

  it('refuses a url source without a url, as the controller refuses it', async () => {
    const { tool, service } = harness();
    const result = await tool.addKnowledgeSource(
      { knowledgeId: 'kb-1', kind: 'url', name: 'x' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('url is required');
    expect(service.addUrl).not.toHaveBeenCalled();
  });

  it('refuses a text source without text', async () => {
    const { tool, service } = harness();
    const result = await tool.addKnowledgeSource(
      { knowledgeId: 'kb-1', kind: 'text', name: 'x' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('text is required');
    expect(service.addText).not.toHaveBeenCalled();
  });

  it('adds every page of a sitemap under a prefix', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.addKnowledgeSourcesFromSitemap(
        {
          knowledgeId: 'kb-1',
          sitemapUrl: 'https://docs.example/sitemap.xml',
          urlPrefix: 'https://docs.example/guide/',
        },
        null,
        operator(),
      ),
    );
    expect(service.addFromSitemap).toHaveBeenCalledWith(
      'kb-1',
      'https://docs.example/sitemap.xml',
      'https://docs.example/guide/',
    );
    expect(text).toContain('"added": 3');
    expect(text).toContain('"discovered": 5');
  });

  it('relays a sitemap that cannot be read as a refusal with the reason', async () => {
    const { tool, service } = harness();
    service.addFromSitemap.mockRejectedValue(
      new BadRequestException('Sitemap returned 404'),
    );
    const result = await tool.addKnowledgeSourcesFromSitemap(
      { knowledgeId: 'kb-1', sitemapUrl: 'https://docs.example/nope.xml' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Sitemap returned 404');
  });
});

describe('SourceTool — per-source actions', () => {
  it('reindexes a source of the base', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.reindexKnowledgeSource(
        { knowledgeId: 'kb-1', sourceId: 'src-1' },
        null,
        operator(),
      ),
    );
    expect(service.reindexSource).toHaveBeenCalledWith('kb-1', 'src-1');
    expect(text).toContain('Returns policy');
    expect(text).toContain('list_knowledge_sources');
  });

  it('reports an unknown source and names the list to call', async () => {
    const { tool, service, gateway } = harness();
    gateway.findById.mockResolvedValue(null);
    const result = await tool.reindexKnowledgeSource(
      { knowledgeId: 'kb-1', sourceId: 'nope' },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('not found');
    expect(textOf(result)).toContain('list_knowledge_sources');
    expect(service.reindexSource).not.toHaveBeenCalled();
  });

  it('treats a source of another base as not found', async () => {
    const { tool, service } = harness();
    const result = await tool.reindexKnowledgeSource(
      { knowledgeId: 'kb-other', sourceId: 'src-1' },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('not found');
    expect(textOf(result)).toContain('kb-other');
    expect(service.reindexSource).not.toHaveBeenCalled();
  });

  it('schedules extraction for a PDF source', async () => {
    const { tool, service, gateway } = harness();
    gateway.findById.mockResolvedValue(
      source({ type: 'file', mimeType: 'application/pdf', name: 'scan.pdf' }),
    );
    const text = textOf(
      await tool.extractKnowledgeSource(
        { knowledgeId: 'kb-1', sourceId: 'src-1' },
        null,
        operator(),
      ),
    );
    expect(service.reextractSource).toHaveBeenCalledWith('kb-1', 'src-1');
    expect(text).toContain('scan.pdf');
    expect(text).toContain('textState');
  });

  it('relays the service refusal for a source that is not a PDF', async () => {
    const { tool, service } = harness();
    service.reextractSource.mockRejectedValue(
      new BadRequestException('Only PDF file sources can be re-extracted'),
    );
    const result = await tool.extractKnowledgeSource(
      { knowledgeId: 'kb-1', sourceId: 'src-1' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Only PDF file sources');
  });

  it('reports an unknown source for extraction without calling the service', async () => {
    const { tool, service, gateway } = harness();
    gateway.findById.mockResolvedValue(null);
    const result = await tool.extractKnowledgeSource(
      { knowledgeId: 'kb-1', sourceId: 'nope' },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('not found');
    expect(service.reextractSource).not.toHaveBeenCalled();
  });
});

describe('SourceTool — deleting', () => {
  it('refuses without the confirmation argument and touches nothing', async () => {
    const { tool, service } = harness();
    const result = await tool.deleteKnowledgeSource(
      { knowledgeId: 'kb-1', sourceId: 'src-1' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm: true');
    expect(textOf(result)).toContain('«Returns policy»');
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('reports not found before asking for a confirmation', async () => {
    const { tool, service, gateway } = harness();
    gateway.findById.mockResolvedValue(null);
    const result = await tool.deleteKnowledgeSource(
      { knowledgeId: 'kb-1', sourceId: 'nope' },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('not found');
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('deletes once confirmed and names what went', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.deleteKnowledgeSource(
        { knowledgeId: 'kb-1', sourceId: 'src-1', confirm: true },
        null,
        operator(),
      ),
    );
    expect(service.delete).toHaveBeenCalledWith('src-1');
    expect(text).toContain('"deleted": true');
    expect(text).toContain('Returns policy');
  });

  it('reports a source that vanished between the read and the delete', async () => {
    const { tool, service } = harness();
    service.delete.mockRejectedValue(
      new NotFoundException('Source src-1 not found'),
    );
    const result = await tool.deleteKnowledgeSource(
      { knowledgeId: 'kb-1', sourceId: 'src-1', confirm: true },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('not found');
  });
});
