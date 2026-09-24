import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { FileTool } from './file.tool';
import type { IAgentGateway } from '#/agent/agent/domain';
import type { IBridleGateway } from '#/bridle/domain';
import type { IFileGateway, SyncGuardService } from './domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Two things matter more than the happy paths here: that a plain agent can
 * neither see nor call these tools, and that the sync guard (CLEAN-50) and
 * the delete confirmation both stop BEFORE anything touches S3 or the pod.
 */
const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

const agentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'agent-a',
  name: 'Support Bot',
  lastPullAt: new Date('2026-09-17T10:00:00.000Z'),
  lastSyncAt: null,
  ...overrides,
});

interface Harness {
  tool: FileTool;
  agents: { findById: jest.Mock; setLastSyncAt: jest.Mock };
  files: {
    list: jest.Mock;
    delete: jest.Mock;
    deletePrefix: jest.Mock;
    readRange: jest.Mock;
    putStage: jest.Mock;
    save: jest.Mock;
  };
  bridle: { syncAgent: jest.Mock };
  syncGuard: { assess: jest.Mock };
  archive: { validate: jest.Mock; plan: jest.Mock };
  proposals: {
    propose: jest.Mock;
    proposeImport: jest.Mock;
    get: jest.Mock;
    apply: jest.Mock;
  };
  attachments: { fetch: jest.Mock };
}

const pendingRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  agentId: 'agent-a',
  chatAgentId: 'agent-ops',
  kind: 'single',
  op: 'write',
  path: 'agent.config.json',
  status: 'pending',
  additions: 1,
  deletions: 1,
  changedLines: 2,
  firstChangedLine: 12,
  diffStatus: 'ok',
  proposedBytes: 856,
  summary: null,
  mode: null,
  reason: null,
  result: null,
  ...overrides,
});

function harness(): Harness {
  const agents = {
    findById: jest.fn().mockResolvedValue(agentRow()),
    setLastSyncAt: jest.fn().mockResolvedValue(undefined),
  };
  const files = {
    list: jest.fn().mockResolvedValue([
      {
        path: 'SOUL.md',
        size: 10,
        updatedAt: new Date('2026-09-17T09:00:00.000Z'),
        kind: 'text',
        editable: true,
      },
      {
        path: 'skills/x/SKILL.md',
        size: 20,
        updatedAt: new Date('2026-09-17T09:00:00.000Z'),
        kind: 'text',
        editable: true,
      },
      {
        path: 'data/photo.png',
        size: 2000,
        updatedAt: new Date('2026-09-17T09:00:00.000Z'),
        kind: 'binary',
        editable: false,
      },
    ]),
    delete: jest.fn().mockResolvedValue(undefined),
    deletePrefix: jest.fn().mockResolvedValue(3),
    readRange: jest.fn().mockResolvedValue({
      path: 'SOUL.md',
      content: 'hello',
      size: 5,
      totalSize: 5,
      offset: 0,
      nextOffset: null,
      hasMore: false,
      updatedAt: new Date('2026-09-17T09:00:00.000Z'),
      kind: 'text',
      editable: true,
    }),
    putStage: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const bridle = {
    syncAgent: jest.fn().mockResolvedValue({ agentOnline: true, pushed: 4 }),
  };
  const syncGuard = {
    assess: jest.fn().mockResolvedValue({ baseline: null, atRisk: [] }),
  };
  const archive = {
    validate: jest.fn().mockResolvedValue({
      entries: [
        { path: 'SOUL.md', size: 3, md5: 'x', bytes: Buffer.from('new') },
      ],
      wrapperStripped: null,
    }),
    plan: jest.fn().mockResolvedValue({
      importId: 'imp',
      mode: 'merge',
      includeSessions: false,
      wrapperStripped: null,
      counts: { add: 0, change: 1, unchanged: 0, remove: 0, skip: 0 },
      totalBytes: 3,
      entries: [{ path: 'SOUL.md', action: 'change', size: 3 }],
      more: 0,
      warnings: [],
    }),
  };
  const proposals = {
    propose: jest.fn().mockResolvedValue(pendingRow()),
    proposeImport: jest.fn().mockResolvedValue(
      pendingRow({
        id: 'prop-set',
        kind: 'set',
        op: 'import',
        path: null,
        mode: 'merge',
        summary: {
          counts: { add: 0, change: 1, unchanged: 0, remove: 0, skip: 0 },
        },
      }),
    ),
    get: jest.fn().mockResolvedValue(pendingRow()),
    apply: jest
      .fn()
      .mockResolvedValue(
        pendingRow({ status: 'applied', result: { etag: 'e2' } }),
      ),
  };
  const attachments = {
    fetch: jest.fn().mockResolvedValue({
      id: 'att-1',
      name: 'ws.zip',
      mimeType: 'application/zip',
      size: 3,
      body: Buffer.from('zip'),
    }),
  };

  const tool = new FileTool(
    agents as unknown as IAgentGateway,
    files as unknown as IFileGateway,
    bridle as unknown as IBridleGateway,
    syncGuard as unknown as SyncGuardService,
    archive as never,
    proposals as never,
    attachments as never,
  );
  return {
    tool,
    agents,
    files,
    bridle,
    syncGuard,
    archive,
    proposals,
    attachments,
  };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('FileTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, files, bridle } = harness();
    await expect(
      tool.deleteAgentFile(
        { agentId: 'agent-a', path: 'SOUL.md', confirm: true },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.syncAgentFiles({ agentId: 'agent-a' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.exportAgentFiles({ agentId: 'agent-a' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(files.delete).not.toHaveBeenCalled();
    expect(bridle.syncAgent).not.toHaveBeenCalled();
  });
});

describe('delete_agent_file', () => {
  it('reports an unknown agent before asking for a confirmation', async () => {
    const { tool, agents, files } = harness();
    agents.findById.mockResolvedValue(null);
    const result = await tool.deleteAgentFile(
      { agentId: 'nope', path: 'SOUL.md' },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('not found');
    expect(textOf(result)).toContain('list_agents');
    expect(files.delete).not.toHaveBeenCalled();
  });

  it('refuses without confirm and names the file and the agent', async () => {
    const { tool, files } = harness();
    const result = await tool.deleteAgentFile(
      { agentId: 'agent-a', path: 'SOUL.md' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('«SOUL.md»');
    expect(textOf(result)).toContain('«Support Bot»');
    expect(textOf(result)).toContain('confirm: true');
    expect(files.delete).not.toHaveBeenCalled();
    expect(files.deletePrefix).not.toHaveBeenCalled();
  });

  it('deletes one file when confirmed', async () => {
    const { tool, files } = harness();
    const result = await tool.deleteAgentFile(
      { agentId: 'agent-a', path: 'SOUL.md', confirm: true },
      null,
      operator(),
    );
    expect(files.delete).toHaveBeenCalledWith('agent-a', 'SOUL.md');
    expect(files.deletePrefix).not.toHaveBeenCalled();
    const body = JSON.parse(textOf(result));
    expect(body.deleted).toBe(1);
    expect(body.recursive).toBe(false);
    expect(body.notice).toContain('restart');
  });

  it('deletes a whole folder when recursive, as the console does', async () => {
    const { tool, files } = harness();
    const result = await tool.deleteAgentFile(
      { agentId: 'agent-a', path: 'skills/x', recursive: true, confirm: true },
      null,
      operator(),
    );
    expect(files.deletePrefix).toHaveBeenCalledWith('agent-a', 'skills/x');
    expect(files.delete).not.toHaveBeenCalled();
    const body = JSON.parse(textOf(result));
    expect(body.deleted).toBe(3);
    expect(body.recursive).toBe(true);
  });
});

describe('sync_agent_files', () => {
  it('reports an unknown agent and does not touch the pod', async () => {
    const { tool, agents, bridle, syncGuard } = harness();
    agents.findById.mockResolvedValue(null);
    const result = await tool.syncAgentFiles(
      { agentId: 'nope' },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('not found');
    expect(syncGuard.assess).not.toHaveBeenCalled();
    expect(bridle.syncAgent).not.toHaveBeenCalled();
  });

  it('assesses with the agent markers and syncs when nothing is at risk', async () => {
    const { tool, agents, bridle, syncGuard } = harness();
    const result = await tool.syncAgentFiles(
      { agentId: 'agent-a' },
      null,
      operator(),
    );
    expect(syncGuard.assess).toHaveBeenCalledWith(
      'agent-a',
      new Date('2026-09-17T10:00:00.000Z'),
      null,
    );
    expect(bridle.syncAgent).toHaveBeenCalledWith('agent-a');
    expect(agents.setLastSyncAt).toHaveBeenCalledWith('agent-a');
    const body = JSON.parse(textOf(result));
    expect(body).toMatchObject({ agentOnline: true, pushed: 4 });
    expect(body.notice).toBeUndefined();
  });

  it('refuses with the at-risk list and does NOT sync', async () => {
    const { tool, bridle, agents, syncGuard } = harness();
    syncGuard.assess.mockResolvedValue({
      baseline: new Date('2026-09-17T09:59:00.000Z'),
      atRisk: [
        {
          path: 'SOUL.md',
          size: 10,
          updatedAt: new Date('2026-09-17T11:00:00.000Z'),
        },
      ],
    });
    const result = await tool.syncAgentFiles(
      { agentId: 'agent-a' },
      null,
      operator(),
    );
    const body = JSON.parse(textOf(result));
    expect(body.requiresConfirmation).toBe(true);
    expect(body.atRisk).toEqual([
      { path: 'SOUL.md', updatedAt: '2026-09-17T11:00:00.000Z' },
    ]);
    expect(body.baseline).toBe('2026-09-17T09:59:00.000Z');
    expect(body.notice).toContain('confirm: true');
    expect(bridle.syncAgent).not.toHaveBeenCalled();
    expect(agents.setLastSyncAt).not.toHaveBeenCalled();
  });

  it('skips the guard once the person accepted the risk', async () => {
    const { tool, bridle, syncGuard } = harness();
    syncGuard.assess.mockResolvedValue({
      baseline: new Date('2026-09-17T09:59:00.000Z'),
      atRisk: [
        {
          path: 'SOUL.md',
          size: 10,
          updatedAt: new Date('2026-09-17T11:00:00.000Z'),
        },
      ],
    });
    await tool.syncAgentFiles(
      { agentId: 'agent-a', confirm: true },
      null,
      operator(),
    );
    expect(syncGuard.assess).not.toHaveBeenCalled();
    expect(bridle.syncAgent).toHaveBeenCalledWith('agent-a');
  });

  it('does not advance the baseline when the agent is offline', async () => {
    const { tool, agents, bridle } = harness();
    bridle.syncAgent.mockResolvedValue({ agentOnline: false, pushed: 0 });
    const result = await tool.syncAgentFiles(
      { agentId: 'agent-a' },
      null,
      operator(),
    );
    expect(agents.setLastSyncAt).not.toHaveBeenCalled();
    const body = JSON.parse(textOf(result));
    expect(body).toMatchObject({ agentOnline: false, pushed: 0 });
    expect(body.notice).toContain('not connected');
  });
});

describe('export_agent_files', () => {
  it('hands back the console download path and the file count', async () => {
    const { tool, files } = harness();
    const result = await tool.exportAgentFiles(
      { agentId: 'agent-a' },
      null,
      operator(),
    );
    expect(files.list).toHaveBeenCalledWith('agent-a');
    const body = JSON.parse(textOf(result));
    expect(body.downloadPath).toBe('/agents/agent-a/files/export');
    expect(body.fileCount).toBe(3);
    expect(body.note).toContain('login');
  });

  it('reports an unknown agent', async () => {
    const { tool, agents, files } = harness();
    agents.findById.mockResolvedValue(null);
    const result = await tool.exportAgentFiles(
      { agentId: 'nope' },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('not found');
    expect(files.list).not.toHaveBeenCalled();
  });
});
