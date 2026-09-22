import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { KnowledgeAdminTool } from './knowledgeAdmin.tool';
import type { KnowledgeService } from './domain/knowledge.service';
import type { IKnowledgeData } from './domain/knowledge.types';
import type { IKnowledgeConfigGateway } from '../config/domain/knowledgeConfig.gateway';
import type { ILightragClient } from '../lightrag/domain/lightrag.client';
import type { ILlmGateway } from '#/llm/domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * These tools let an agent decide what every other agent is allowed to read,
 * and delete it. So beyond the happy paths: a plain agent must not see or
 * call them, a delete must not happen on a bare request, a wrong id must be
 * reported as such and never as a request for confirmation, and the service
 * api key must never appear in a status answer.
 */
const API_KEY = 'lightrag-secret-key-1234';

const base = (overrides: Partial<IKnowledgeData> = {}): IKnowledgeData => ({
  id: 'kb-1',
  name: 'Returns policy',
  description: 'How returns and refunds work',
  workspace: 'ws-kb-1',
  indexStatus: 'ready',
  indexError: null,
  indexedAt: new Date('2026-09-17T10:00:00.000Z'),
  indexStartedAt: null,
  instanceState: 'ready',
  instanceError: null,
  instanceEndpoint: null,
  migrationState: 'done',
  createdAt: new Date('2026-09-17T09:00:00.000Z'),
  updatedAt: new Date('2026-09-17T10:00:00.000Z'),
  sourceCount: 3,
  indexedCount: 3,
  failedCount: 0,
  retryingCount: 0,
  processingCount: 0,
  indexRunAlive: false,
  ...overrides,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

interface Harness {
  tool: KnowledgeAdminTool;
  service: {
    listPage: jest.Mock;
    getWithDerivedStatus: jest.Mock;
    get: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    startIndex: jest.Mock;
    getOverview: jest.Mock;
    getGraphLabels: jest.Mock;
  };
  config: {
    isEnabled: jest.Mock;
    resolve: jest.Mock;
    getSelectedCredentialIds: jest.Mock;
  };
  lightrag: { health: jest.Mock };
  llm: { hasCredentialWithCapability: jest.Mock };
}

function harness(): Harness {
  const service = {
    listPage: jest.fn().mockResolvedValue({
      items: [{ ...base(), sourcesCount: 3, totalSizeBytes: 2048 }],
      total: 1,
      page: 1,
      perPage: 50,
    }),
    getWithDerivedStatus: jest.fn().mockResolvedValue(base()),
    get: jest.fn().mockResolvedValue(base()),
    create: jest
      .fn()
      .mockResolvedValue(
        base({ id: 'kb-2', name: 'Shipping', sourceCount: 0 }),
      ),
    update: jest.fn().mockResolvedValue(base({ name: 'Returns & refunds' })),
    delete: jest.fn().mockResolvedValue(undefined),
    startIndex: jest.fn().mockResolvedValue(undefined),
    getOverview: jest.fn().mockResolvedValue({
      sourceCount: 3,
      indexedCount: 3,
      failedCount: 0,
      retryingCount: 0,
      processingCount: 0,
      byType: { file: 2, url: 1, text: 0 },
      totalSizeBytes: 2048,
    }),
    getGraphLabels: jest.fn().mockResolvedValue({
      labels: ['Refund', 'Return window'],
      total: 2,
      truncated: false,
    }),
  };
  const config = {
    isEnabled: jest.fn().mockResolvedValue(true),
    resolve: jest.fn().mockResolvedValue({
      url: 'http://lightrag:9621',
      apiKey: API_KEY,
      bucket: 'ranch-knowledge',
      enabled: true,
    }),
    getSelectedCredentialIds: jest
      .fn()
      .mockResolvedValue({ chat: 'cred-chat', embedding: null }),
  };
  const lightrag = {
    health: jest.fn().mockResolvedValue({
      ok: true,
      configuration: {
        llmBinding: 'openai',
        llmModel: 'gpt-4o-mini',
        embeddingBinding: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingBindingHost: null,
      },
    }),
  };
  const llm = {
    hasCredentialWithCapability: jest.fn().mockResolvedValue(true),
  };

  const tool = new KnowledgeAdminTool(
    service as unknown as KnowledgeService,
    config as unknown as IKnowledgeConfigGateway,
    lightrag as unknown as ILightragClient,
    llm as unknown as ILlmGateway,
  );
  return { tool, service, config, lightrag, llm };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('KnowledgeAdminTool — who may use it', () => {
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
      tool.deleteKnowledge({ id: 'kb-1', confirm: true }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('refuses a caller with no roles at all', async () => {
    const { tool, service } = harness();
    await expect(
      tool.listKnowledges({}, null, {} as Request),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.listPage).not.toHaveBeenCalled();
  });
});

describe('KnowledgeAdminTool — reading', () => {
  it('lists a page with the search and paging the route accepts', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.listKnowledges(
        { search: 'return', page: 2, perPage: 10 },
        null,
        operator(),
      ),
    );
    expect(service.listPage).toHaveBeenCalledWith({
      search: 'return',
      page: 2,
      perPage: 10,
    });
    expect(text).toContain('Returns policy');
    expect(text).toContain('"total": 1');
  });

  it('answers an empty page, not a refusal, when the service is not configured', async () => {
    const { tool, service, config } = harness();
    config.isEnabled.mockResolvedValue(false);
    const result = await tool.listKnowledges({ perPage: 5 }, null, operator());
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('"total": 0');
    expect(textOf(result)).toContain('"perPage": 5');
    expect(textOf(result)).toContain('get_knowledge_status');
    expect(service.listPage).not.toHaveBeenCalled();
  });

  it('shows one base with the status derived from its sources', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.getKnowledge({ id: 'kb-1' }, null, operator()),
    );
    expect(service.getWithDerivedStatus).toHaveBeenCalledWith('kb-1');
    expect(text).toContain('Returns policy');
    expect(text).toContain('"indexStatus": "ready"');
  });

  it('names list_knowledges when the id does not exist', async () => {
    const { tool, service } = harness();
    service.getWithDerivedStatus.mockRejectedValue(
      new NotFoundException('Knowledge kb-9 not found'),
    );
    const text = textOf(
      await tool.getKnowledge({ id: 'kb-9' }, null, operator()),
    );
    expect(text).toContain('kb-9 not found');
    expect(text).toContain('list_knowledges');
  });

  it('refuses a per-base read when the service is not configured, naming the status tool', async () => {
    const { tool, service, config } = harness();
    config.isEnabled.mockResolvedValue(false);
    const result = await tool.getKnowledge({ id: 'kb-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('get_knowledge_status');
    expect(service.getWithDerivedStatus).not.toHaveBeenCalled();
  });

  it('reads the overview in one call', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.getKnowledgeOverview({ id: 'kb-1' }, null, operator()),
    );
    expect(service.getOverview).toHaveBeenCalledWith('kb-1');
    expect(text).toContain('"totalSizeBytes": 2048');
    expect(text).toContain('"url": 1');
  });

  it('passes the label filter and cap through to the service', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.listKnowledgeGraphLabels(
        { id: 'kb-1', search: 'ref', limit: 10 },
        null,
        operator(),
      ),
    );
    expect(service.getGraphLabels).toHaveBeenCalledWith('kb-1', {
      search: 'ref',
      limit: 10,
    });
    expect(text).toContain('Refund');
    expect(text).toContain('"truncated": false');
  });

  it('reports a missing base for labels too', async () => {
    const { tool, service } = harness();
    service.getGraphLabels.mockRejectedValue(
      new NotFoundException('Knowledge kb-9 not found'),
    );
    const text = textOf(
      await tool.listKnowledgeGraphLabels({ id: 'kb-9' }, null, operator()),
    );
    expect(text).toContain('kb-9 not found');
    expect(text).toContain('list_knowledges');
  });
});

describe('KnowledgeAdminTool — service status', () => {
  it('reports readiness the way GET knowledges/status does', async () => {
    const { tool, lightrag, llm } = harness();
    const text = textOf(await tool.getKnowledgeStatus({}, null, operator()));
    expect(llm.hasCredentialWithCapability).toHaveBeenCalledWith('chat');
    expect(llm.hasCredentialWithCapability).toHaveBeenCalledWith('embedding');
    expect(lightrag.health).toHaveBeenCalled();
    expect(text).toContain('"enabled": true');
    expect(text).toContain('"isHealthy": true');
    expect(text).toContain('"hasCredentialsSelected": true');
    expect(text).toContain('"llmModel": "gpt-4o-mini"');
  });

  it('never includes the service api key', async () => {
    const { tool } = harness();
    const text = textOf(await tool.getKnowledgeStatus({}, null, operator()));
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain('apiKey');
  });

  it('does not probe health without a URL, and reports unhealthy', async () => {
    const { tool, config, lightrag } = harness();
    config.resolve.mockResolvedValue({
      url: '',
      apiKey: '',
      bucket: '',
      enabled: false,
    });
    const text = textOf(await tool.getKnowledgeStatus({}, null, operator()));
    expect(lightrag.health).not.toHaveBeenCalled();
    expect(text).toContain('"hasUrl": false');
    expect(text).toContain('"hasBucket": false');
    expect(text).toContain('"isHealthy": false');
    expect(text).toContain('"runtime": null');
  });

  it('treats a failing health check as unhealthy rather than as an error', async () => {
    const { tool, lightrag } = harness();
    lightrag.health.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await tool.getKnowledgeStatus({}, null, operator());
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('"isHealthy": false');
  });
});

describe('KnowledgeAdminTool — changing', () => {
  it('creates a base with the fields POST knowledges takes', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.createKnowledge(
        { name: 'Shipping', description: 'Carriers and delivery times' },
        null,
        operator(),
      ),
    );
    expect(service.create).toHaveBeenCalledWith({
      name: 'Shipping',
      description: 'Carriers and delivery times',
    });
    expect(text).toContain('"id": "kb-2"');
    expect(text).toContain('Shipping');
  });

  it('refuses to create when the service is not configured', async () => {
    const { tool, service, config } = harness();
    config.isEnabled.mockResolvedValue(false);
    const result = await tool.createKnowledge(
      { name: 'Shipping' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('updates only what was passed', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.updateKnowledge(
        { id: 'kb-1', name: 'Returns & refunds' },
        null,
        operator(),
      ),
    );
    expect(service.update).toHaveBeenCalledWith('kb-1', {
      name: 'Returns & refunds',
      description: undefined,
    });
    expect(text).toContain('Returns & refunds');
  });

  it('lets a null description clear it', async () => {
    const { tool, service } = harness();
    await tool.updateKnowledge(
      { id: 'kb-1', description: null },
      null,
      operator(),
    );
    expect(service.update).toHaveBeenCalledWith('kb-1', {
      name: undefined,
      description: null,
    });
  });

  it('refuses an update that changes nothing without touching the service', async () => {
    const { tool, service } = harness();
    const result = await tool.updateKnowledge({ id: 'kb-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Nothing to change');
    expect(service.update).not.toHaveBeenCalled();
  });

  it('reports a missing base on update', async () => {
    const { tool, service } = harness();
    service.update.mockRejectedValue(
      new NotFoundException('Knowledge kb-9 not found'),
    );
    const text = textOf(
      await tool.updateKnowledge({ id: 'kb-9', name: 'x' }, null, operator()),
    );
    expect(text).toContain('kb-9 not found');
    expect(text).toContain('list_knowledges');
  });

  it('starts an index run and says where to watch it', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.indexKnowledge({ id: 'kb-1' }, null, operator()),
    );
    expect(service.startIndex).toHaveBeenCalledWith('kb-1');
    expect(text).toContain('Indexing started');
    expect(text).toContain('get_knowledge_overview');
  });

  it("surfaces the service's refusal when a run is already going", async () => {
    const { tool, service } = harness();
    service.startIndex.mockRejectedValue(
      new ConflictException(
        'Knowledge kb-1 is already being indexed (started 3 min ago).',
      ),
    );
    const result = await tool.indexKnowledge({ id: 'kb-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('already being indexed');
  });

  it('reports a missing base on index', async () => {
    const { tool, service } = harness();
    service.startIndex.mockRejectedValue(
      new NotFoundException('Knowledge kb-9 not found'),
    );
    const text = textOf(
      await tool.indexKnowledge({ id: 'kb-9' }, null, operator()),
    );
    expect(text).toContain('kb-9 not found');
    expect(text).toContain('list_knowledges');
  });
});

describe('KnowledgeAdminTool — deleting', () => {
  it('refuses without the confirmation argument and names the base (CLEAN-109)', async () => {
    const { tool, service } = harness();
    const result = await tool.deleteKnowledge({ id: 'kb-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('«Returns policy»');
    expect(textOf(result)).toContain('3 source(s)');
    expect(textOf(result)).toContain('confirm: true');
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('deletes once confirmed and says what agents lose', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.deleteKnowledge(
        { id: 'kb-1', confirm: true },
        null,
        operator(),
      ),
    );
    expect(service.delete).toHaveBeenCalledWith('kb-1');
    expect(text).toContain('«Returns policy» (kb-1) deleted');
    expect(text).toContain('Agents that had it bound');
  });

  it('reports a wrong id as not found, not as a request for confirmation', async () => {
    const { tool, service } = harness();
    service.get.mockRejectedValue(
      new NotFoundException('Knowledge kb-9 not found'),
    );
    const result = await tool.deleteKnowledge({ id: 'kb-9' }, null, operator());
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('kb-9 not found');
    expect(textOf(result)).toContain('list_knowledges');
    expect(service.delete).not.toHaveBeenCalled();
  });

  it("surfaces the service's refusal to delete", async () => {
    const { tool, service } = harness();
    service.delete.mockRejectedValue(
      new ConflictException('Knowledge kb-1 is bound to 2 agent(s).'),
    );
    const result = await tool.deleteKnowledge(
      { id: 'kb-1', confirm: true },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('bound to 2 agent(s)');
  });

  it('lets a non-HTTP failure escape, so the MCP layer reports it as an error', async () => {
    const { tool, service } = harness();
    service.delete.mockRejectedValue(new Error('database is down'));
    await expect(
      tool.deleteKnowledge({ id: 'kb-1', confirm: true }, null, operator()),
    ).rejects.toThrow('database is down');
  });
});
