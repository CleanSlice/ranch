import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { FileTool, isPrivateAddress } from './file.tool';
import type { IAgentGateway } from '#/agent/agent/domain';
import type { IBridleGateway } from '#/bridle/domain';
import type { IFileGateway, SyncGuardService } from './domain';
import { ProposalNeedsRemoveConfirmError } from './domain/fileProposal.service';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * The five CLEAN-112 tools: list/read return what the console shows, and
 * write/create/import never touch S3 on the first call — they propose, and
 * only a confirming call that names the proposal applies it.
 */
const request = (roles: UserRoleTypes[]): Request =>
  ({ user: { sub: 'agent:agent-ops', email: '', roles } }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

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

function harness() {
  const agents = {
    findById: jest.fn().mockResolvedValue({ id: 'agent-a', name: 'Support Bot' }),
  };
  const files = {
    list: jest.fn().mockResolvedValue([
      { path: 'SOUL.md', size: 10, updatedAt: new Date(0), kind: 'text', editable: true },
      { path: 'skills/x/SKILL.md', size: 20, updatedAt: new Date(0), kind: 'text', editable: true },
      { path: 'data/photo.png', size: 2000, updatedAt: new Date(0), kind: 'binary', editable: false },
    ]),
    readRange: jest.fn().mockResolvedValue({
      path: 'SOUL.md',
      content: 'hello',
      size: 5,
      totalSize: 5,
      offset: 0,
      nextOffset: null,
      hasMore: false,
      updatedAt: new Date(0),
      kind: 'text',
      editable: true,
    }),
    putStage: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const archive = {
    validate: jest.fn().mockResolvedValue({
      entries: [{ path: 'SOUL.md', size: 3, md5: 'x', bytes: Buffer.from('new') }],
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
      pendingRow({ id: 'prop-set', kind: 'set', op: 'import', path: null, mode: 'merge', summary: { counts: { add: 0, change: 1, unchanged: 0, remove: 0, skip: 0 } } }),
    ),
    get: jest.fn().mockResolvedValue(pendingRow()),
    apply: jest.fn().mockResolvedValue(pendingRow({ status: 'applied', result: { etag: 'e2' } })),
  };
  const attachments = {
    fetch: jest.fn().mockResolvedValue({ id: 'att-1', name: 'ws.zip', mimeType: 'application/zip', size: 3, body: Buffer.from('zip') }),
  };
  const tool = new FileTool(
    agents as unknown as IAgentGateway,
    files as unknown as IFileGateway,
    {} as IBridleGateway,
    {} as SyncGuardService,
    archive as never,
    proposals as never,
    attachments as never,
  );
  return { tool, agents, files, archive, proposals, attachments };
}

const parse = (result: { content: { text: string }[] }) =>
  JSON.parse(result.content[0].text) as Record<string, unknown>;
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;

describe('list_agent_files / read_agent_file', () => {
  it('are refused for a plain agent', async () => {
    const { tool } = harness();
    await expect(
      tool.listAgentFiles({ agentId: 'agent-a' }, undefined, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.readAgentFile({ agentId: 'agent-a', path: 'SOUL.md' }, undefined, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('list narrows by prefix and carries kind/editable', async () => {
    const { tool } = harness();
    const all = parse(await tool.listAgentFiles({ agentId: 'agent-a' }, undefined, operator()));
    expect(all.count).toBe(3);
    const skills = parse(
      await tool.listAgentFiles({ agentId: 'agent-a', prefix: 'skills' }, undefined, operator()),
    );
    expect((skills.files as Array<{ path: string }>).map((f) => f.path)).toEqual(['skills/x/SKILL.md']);
    expect((all.files as Array<{ kind: string }>)[2].kind).toBe('binary');
  });

  it('read passes offset and caps the slice, and reports a refusal as an error result', async () => {
    const { tool, files } = harness();
    const res = parse(
      await tool.readAgentFile({ agentId: 'agent-a', path: 'SOUL.md', offset: 0, limit: 10_000_000 }, undefined, operator()),
    );
    expect(res.content).toBe('hello');
    expect(files.readRange.mock.calls[0][3]).toBeLessThanOrEqual(512 * 1024);
    files.readRange.mockRejectedValueOnce(new Error('data/photo.png is not a text file'));
    const refused = await tool.readAgentFile({ agentId: 'agent-a', path: 'data/photo.png' }, undefined, operator());
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('not a text file');
  });
});

describe('write_agent_file / create_agent_file', () => {
  it('propose on the first call and write nothing', async () => {
    const { tool, proposals, files } = harness();
    const res = parse(
      await tool.writeAgentFile(
        { agentId: 'agent-a', path: 'agent.config.json', content: '{"a":1}' },
        undefined,
        operator(),
      ),
    );
    expect(res.status).toBe('pending');
    expect(res.proposalId).toBe('prop-1');
    expect(proposals.propose).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-a', chatAgentId: 'agent-ops', op: 'write' }),
    );
    expect(files.save).not.toHaveBeenCalled();
    expect(proposals.apply).not.toHaveBeenCalled();
  });

  it('confirm applies exactly the named proposal', async () => {
    const { tool, proposals } = harness();
    const res = parse(
      await tool.writeAgentFile(
        { agentId: 'agent-a', path: 'agent.config.json', content: 'x', confirm: true, proposalId: 'prop-1' },
        undefined,
        operator(),
      ),
    );
    expect(res.status).toBe('applied');
    expect(proposals.apply).toHaveBeenCalledWith('prop-1', expect.objectContaining({ via: 'tool', actor: 'agent:agent-ops' }));
  });

  it('confirm without an id, with a foreign id, or with a wrong agent refuses', async () => {
    const { tool, proposals } = harness();
    const noId = await tool.writeAgentFile(
      { agentId: 'agent-a', path: 'a', content: 'x', confirm: true },
      undefined,
      operator(),
    );
    expect(noId.isError).toBe(true);
    proposals.get.mockResolvedValueOnce(pendingRow({ agentId: 'other' }));
    const foreign = await tool.writeAgentFile(
      { agentId: 'agent-a', path: 'a', content: 'x', confirm: true, proposalId: 'prop-1' },
      undefined,
      operator(),
    );
    expect(foreign.isError).toBe(true);
    expect(proposals.apply).not.toHaveBeenCalled();
  });

  it('confirm on a proposal the person already applied reports the final state', async () => {
    const { tool, proposals } = harness();
    proposals.get.mockResolvedValueOnce(pendingRow({ status: 'applied' }));
    const res = parse(
      await tool.writeAgentFile(
        { agentId: 'agent-a', path: 'a', content: 'x', confirm: true, proposalId: 'prop-1' },
        undefined,
        operator(),
      ),
    );
    expect(res.status).toBe('applied');
    expect(proposals.apply).not.toHaveBeenCalled();
  });

  it('create defaults to empty content and proposes with op create', async () => {
    const { tool, proposals } = harness();
    await tool.createAgentFile({ agentId: 'agent-a', path: 'notes/todo.md' }, undefined, operator());
    expect(proposals.propose).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'create', content: '' }),
    );
  });

  it('refuses oversize content before proposing', async () => {
    const { tool, proposals } = harness();
    const res = await tool.writeAgentFile(
      { agentId: 'agent-a', path: 'big.txt', content: 'x'.repeat(1024 * 1024 + 1) },
      undefined,
      operator(),
    );
    expect(res.isError).toBe(true);
    expect(proposals.propose).not.toHaveBeenCalled();
  });
});

describe('import_agent_files', () => {
  it('fetches the attachment from the chat agent, stages, plans and proposes a set', async () => {
    const { tool, attachments, files, proposals } = harness();
    const res = parse(
      await tool.importAgentFiles({ agentId: 'agent-a', attachmentId: 'att-1' }, undefined, operator()),
    );
    expect(attachments.fetch).toHaveBeenCalledWith('agent-ops', 'att-1');
    expect(files.putStage).toHaveBeenCalledWith(
      'agent-a',
      expect.any(String),
      expect.any(Buffer),
      expect.objectContaining({ source: 'attachment' }),
    );
    expect(proposals.proposeImport).toHaveBeenCalledWith(expect.objectContaining({ mode: 'merge' }));
    expect(res.status).toBe('pending');
    expect(res.proposalId).toBe('prop-set');
  });

  it('needs a source and refuses a non-https link and a missing attachment', async () => {
    const { tool, attachments } = harness();
    expect((await tool.importAgentFiles({ agentId: 'agent-a' }, undefined, operator())).isError).toBe(true);
    const http = await tool.importAgentFiles({ agentId: 'agent-a', url: 'http://example.com/a.zip' }, undefined, operator());
    expect(http.isError).toBe(true);
    expect(textOf(http)).toContain('https');
    attachments.fetch.mockResolvedValueOnce(null);
    const missing = await tool.importAgentFiles({ agentId: 'agent-a', attachmentId: 'nope' }, undefined, operator());
    expect(missing.isError).toBe(true);
  });

  it('refuses links with credentials and loopback hosts before any request', async () => {
    const { tool, files } = harness();
    const creds = await tool.importAgentFiles(
      { agentId: 'agent-a', url: 'https://user:pw@example.com/a.zip' },
      undefined,
      operator(),
    );
    expect(creds.isError).toBe(true);
    expect(textOf(creds)).toContain('credentials');
    const loop = await tool.importAgentFiles(
      { agentId: 'agent-a', url: 'https://127.0.0.1/a.zip' },
      undefined,
      operator(),
    );
    expect(loop.isError).toBe(true);
    expect(textOf(loop)).toContain('private address');
    expect(files.putStage).not.toHaveBeenCalled();
  });

  it('confirming a replace with removals needs confirmRemove', async () => {
    const { tool, proposals } = harness();
    proposals.get.mockResolvedValue(pendingRow({ id: 'prop-set', kind: 'set', op: 'import', mode: 'replace', path: null }));
    proposals.apply.mockRejectedValueOnce(new ProposalNeedsRemoveConfirmError(pendingRow() as never, 3));
    const res = await tool.importAgentFiles(
      { agentId: 'agent-a', confirm: true, proposalId: 'prop-set' },
      undefined,
      operator(),
    );
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('remove 3 files');
    proposals.apply.mockResolvedValueOnce(pendingRow({ id: 'prop-set', status: 'applied', result: { written: 3 } }));
    const done = parse(
      await tool.importAgentFiles(
        { agentId: 'agent-a', confirm: true, proposalId: 'prop-set', confirmRemove: true },
        undefined,
        operator(),
      ),
    );
    expect(done.status).toBe('applied');
    expect(proposals.apply).toHaveBeenLastCalledWith('prop-set', expect.objectContaining({ confirmRemove: true }));
  });
});

describe('isPrivateAddress', () => {
  it('flags loopback, private and link-local ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '100.64.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });
  it('lets public addresses through', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111', '93.184.216.34']) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});
