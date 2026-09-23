import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  FileProposalService,
  ProposalNeedsRemoveConfirmError,
  ProposalNotPendingError,
  computeDiff,
} from './fileProposal.service';
import type { IFileGateway } from './file.gateway';
import type {
  ICreateProposal,
  IFileChangeProposal,
  IFileProposalRepository,
  ITransitionPatch,
  ProposalStatus,
} from './fileProposal.types';
import {
  DIFF_COMPARE_MAX_BYTES,
  DIFF_INLINE_MAX_BYTES,
  DIFF_INLINE_MAX_LINES,
} from './file.limits';

// ── In-memory doubles ────────────────────────────────────────

function memoryRepo() {
  const rows = new Map<string, IFileChangeProposal>();
  let n = 0;
  const repo: IFileProposalRepository = {
    async create(input: ICreateProposal) {
      const row: IFileChangeProposal = {
        ...input,
        id: input.id ?? `p${++n}`,
        status: 'pending',
        actedBy: null,
        actedVia: null,
        actedAt: null,
        result: null,
        reason: null,
        createdAt: new Date(1000 + n),
      };
      rows.set(row.id, row);
      return row;
    },
    async findById(id: string) {
      return rows.get(id) ?? null;
    },
    async listForChat() {
      return [...rows.values()];
    },
    async transition(id: string, from: ProposalStatus, to: ProposalStatus, patch: ITransitionPatch) {
      const row = rows.get(id);
      if (!row) return { won: false, row: null };
      if (row.status !== from) return { won: false, row };
      const next: IFileChangeProposal = {
        ...row,
        status: to,
        actedBy: patch.actedBy ?? row.actedBy,
        actedVia: patch.actedVia ?? row.actedVia,
        actedAt: patch.actedAt ?? new Date(),
        result: patch.result ?? row.result,
        reason: patch.reason ?? row.reason,
      };
      rows.set(id, next);
      return { won: true, row: next };
    },
    async markSiblingsStale(agentId: string, path: string, exceptId: string) {
      const out: IFileChangeProposal[] = [];
      for (const [id, row] of rows) {
        if (id === exceptId || row.agentId !== agentId || row.path !== path) continue;
        if (row.status !== 'pending' || row.kind !== 'single') continue;
        const next = { ...row, status: 'stale' as const, reason: 'sibling applied' };
        rows.set(id, next);
        out.push(next);
      }
      return out;
    },
  };
  return { repo, rows };
}

function memoryFiles(initial: Record<string, string> = {}) {
  const objects = new Map<string, string>(Object.entries(initial));
  const proposals = new Map<string, string>();
  const etagOf = (s: string) => `etag-${Buffer.from(s).toString('base64').slice(0, 12)}`;
  const files = {
    async headEtag(_a: string, path: string) {
      const c = objects.get(path);
      return c === undefined ? null : etagOf(c);
    },
    async read(_a: string, path: string) {
      const content = objects.get(path) ?? '';
      return {
        path,
        content,
        size: Buffer.byteLength(content),
        updatedAt: new Date(0),
        kind: 'text' as const,
        editable: true,
      };
    },
    async save(_a: string, path: string, content: string, opts: { createOnly?: boolean } = {}) {
      if (opts.createOnly && objects.has(path)) throw new ConflictException('exists');
      objects.set(path, content);
    },
    async putProposalContent(id: string, content: string) {
      proposals.set(id, content);
    },
    async getProposalContent(id: string) {
      return proposals.get(id) ?? null;
    },
    async deleteProposalContent(id: string) {
      proposals.delete(id);
    },
    async getStage() {
      return null;
    },
    async deleteStage() {},
  };
  return { files: files as unknown as IFileGateway, objects, proposals };
}

function build(initial: Record<string, string> = {}, turn: { clientId: string; turnId: string } | null = null) {
  const { repo, rows } = memoryRepo();
  const { files, objects, proposals } = memoryFiles(initial);
  const sent: unknown[] = [];
  const broadcast: unknown[] = [];
  const hub = {
    findActiveTurn: () => (turn ? { ...turn, ts: 1 } : null),
    sendToClient: (_c: string, _a: string, data: unknown) => sent.push(data),
    sendToAgentClients: (_a: string, data: unknown) => broadcast.push(data),
  };
  const agents = {
    findById: async (id: string) => ({ id, name: `agent-${id}`, status: 'running' }),
  };
  const archive = {
    validate: jest.fn(),
    plan: jest.fn(),
    apply: jest.fn(),
  };
  const service = new FileProposalService(
    files,
    repo,
    archive as never,
    hub as never,
    agents as never,
  );
  return { service, rows, objects, proposals, sent, broadcast, archive };
}

// ── computeDiff caps ─────────────────────────────────────────

describe('computeDiff', () => {
  it('counts additions and deletions and keeps a small diff inline', () => {
    const base = '{\n  "a": 1,\n  "b": 2\n}\n';
    const next = '{\n  "a": 1,\n  "b": 3\n}\n';
    const d = computeDiff('x.json', base, next);
    expect(d.additions).toBe(1);
    expect(d.deletions).toBe(1);
    expect(d.changedLines).toBe(2);
    expect(d.firstChangedLine).toBe(3);
    expect(d.inlineDiff).toContain('-  "b": 2');
    expect(d.inlineDiff).toContain('+  "b": 3');
  });

  it('keeps the inline diff at exactly the line cap and drops it one above', () => {
    const lines = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) => `${tag}${i}`).join('\n') + '\n';
    const atCap = computeDiff('f.txt', '', lines(DIFF_INLINE_MAX_LINES, 'l'));
    expect(atCap.changedLines).toBe(DIFF_INLINE_MAX_LINES);
    expect(atCap.inlineDiff).not.toBeNull();
    const over = computeDiff('f.txt', '', lines(DIFF_INLINE_MAX_LINES + 1, 'l'));
    expect(over.inlineDiff).toBeNull();
    expect(over.additions).toBe(DIFF_INLINE_MAX_LINES + 1);
  });

  it('drops the inline diff above the byte cap even for one changed line', () => {
    const big = 'x'.repeat(DIFF_INLINE_MAX_BYTES + 1) + '\n';
    const d = computeDiff('f.txt', 'old\n', big);
    expect(d.changedLines).toBe(2);
    expect(d.inlineDiff).toBeNull();
  });

  it('reports no change for identical content', () => {
    const d = computeDiff('f.txt', 'same\n', 'same\n');
    expect(d.changedLines).toBe(0);
    expect(d.inlineDiff).toBeNull();
    expect(d.firstChangedLine).toBeNull();
  });
});

// ── propose ──────────────────────────────────────────────────

describe('FileProposalService.propose', () => {
  it('stores the content, computes the diff, writes nothing and publishes to the active turn', async () => {
    const { service, objects, proposals, sent } = build(
      { 'agent.config.json': '{\n  "heartbeat": {\n    "intervalMin": 30\n  }\n}\n' },
      { clientId: 'admin', turnId: 't1' },
    );
    const row = await service.propose({
      agentId: 'a1',
      chatAgentId: 'rancher',
      path: 'agent.config.json',
      content: '{\n  "heartbeat": {\n    "intervalMin": 45\n  }\n}\n',
      op: 'write',
    });
    expect(row.status).toBe('pending');
    expect(row.additions).toBe(1);
    expect(row.deletions).toBe(1);
    expect(row.firstChangedLine).toBe(3);
    expect(row.inlineDiff).toContain('"intervalMin": 45');
    expect(row.channel).toBe('admin');
    expect(row.turnId).toBe('t1');
    // Nothing written to the workspace; the content waits in the proposal store.
    expect(objects.get('agent.config.json')).toContain('30');
    expect(proposals.get(row.id)).toContain('45');
    expect(sent).toHaveLength(1);
    expect((sent[0] as { type: string }).type).toBe('proposal');
  });

  it('does not publish without an active turn (the card shows on reload)', async () => {
    const { service, sent } = build({ 'SOUL.md': 'a\n' }, null);
    const row = await service.propose({
      agentId: 'a1',
      chatAgentId: 'rancher',
      path: 'SOUL.md',
      content: 'b\n',
      op: 'write',
    });
    expect(row.clientId).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('refuses invalid JSON, binary paths and oversize content before proposing', async () => {
    const { service, rows } = build();
    await expect(
      service.propose({ agentId: 'a1', chatAgentId: 'r', path: 'x.json', content: '{', op: 'write' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.propose({ agentId: 'a1', chatAgentId: 'r', path: 'x.png', content: 'p', op: 'write' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.propose({
        agentId: 'a1',
        chatAgentId: 'r',
        path: 'big.txt',
        content: 'x'.repeat(DIFF_COMPARE_MAX_BYTES + 1),
        op: 'write',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.size).toBe(0);
  });

  it('refuses create on an existing path', async () => {
    const { service } = build({ 'notes.md': 'x' });
    await expect(
      service.propose({ agentId: 'a1', chatAgentId: 'r', path: 'notes.md', content: 'y', op: 'create' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// ── apply / skip / stale ─────────────────────────────────────

describe('FileProposalService.apply', () => {
  const setup = async () => {
    const ctx = build({ 'SOUL.md': 'old\n' }, { clientId: 'admin', turnId: 't' });
    const row = await ctx.service.propose({
      agentId: 'a1',
      chatAgentId: 'rancher',
      path: 'SOUL.md',
      content: 'new\n',
      op: 'write',
    });
    return { ...ctx, row };
  };

  it('writes exactly once on Apply and broadcasts the update', async () => {
    const { service, row, objects, broadcast, proposals } = await setup();
    const applied = await service.apply(row.id, { actor: 'u1', via: 'card' });
    expect(applied.status).toBe('applied');
    expect(objects.get('SOUL.md')).toBe('new\n');
    expect(proposals.has(row.id)).toBe(false);
    expect(broadcast.map((e) => (e as { status: string }).status)).toEqual(['applied']);
    await expect(service.apply(row.id, { actor: 'u1', via: 'card' })).rejects.toBeInstanceOf(
      ProposalNotPendingError,
    );
  });

  it('applies the edited content from the editor instead of the proposed one', async () => {
    const { service, row, objects } = await setup();
    await service.apply(row.id, { actor: 'u1', via: 'editor', content: 'edited\n' });
    expect(objects.get('SOUL.md')).toBe('edited\n');
  });

  it('goes stale when the file moved on since the proposal', async () => {
    const { service, row, objects } = await setup();
    objects.set('SOUL.md', 'someone else\n');
    const res = await service.apply(row.id, { actor: 'u1', via: 'card' });
    expect(res.status).toBe('stale');
    expect(objects.get('SOUL.md')).toBe('someone else\n');
  });

  it('skips without writing', async () => {
    const { service, row, objects, broadcast } = await setup();
    const res = await service.skip(row.id, 'u1');
    expect(res.status).toBe('skipped');
    expect(objects.get('SOUL.md')).toBe('old\n');
    expect(broadcast).toHaveLength(1);
  });

  it('marks sibling proposals for the same file stale once one is applied', async () => {
    const { service, row } = await setup();
    const sibling = await service.propose({
      agentId: 'a1',
      chatAgentId: 'rancher',
      path: 'SOUL.md',
      content: 'other\n',
      op: 'write',
    });
    await service.apply(row.id, { actor: 'u1', via: 'card' });
    const after = await service.get(sibling.id);
    expect(after.status).toBe('stale');
  });
});

describe('FileProposalService import proposals', () => {
  it('lists counts and capped rows, never a diff, and needs confirmRemove for replace removals', async () => {
    const ctx = build({}, null);
    const plan = {
      importId: 'imp1',
      mode: 'replace' as const,
      includeSessions: false,
      wrapperStripped: null,
      counts: { add: 2, change: 1, unchanged: 5, remove: 3, skip: 1 },
      totalBytes: 100,
      entries: [
        { path: 'a.md', action: 'add' as const, size: 10 },
        { path: 'b.md', action: 'unchanged' as const, size: 10 },
        { path: 'c.md', action: 'remove' as const, size: 10 },
      ],
      more: 0,
      warnings: [],
    };
    const row = await ctx.service.proposeImport({
      agentId: 'a1',
      chatAgentId: 'rancher',
      importId: 'imp1',
      plan,
      mode: 'replace',
      includeSessions: false,
    });
    expect(row.kind).toBe('set');
    expect(row.diffStatus).toBe('none');
    expect(row.summary?.rows.map((r) => r.path)).toEqual(['a.md', 'c.md']);

    ctx.archive.validate.mockResolvedValue({ entries: [], wrapperStripped: null });
    ctx.archive.plan.mockResolvedValue(plan);
    (ctx.service as unknown as { files: { getStage: () => Promise<unknown> } }).files.getStage =
      async () => ({ zip: Buffer.alloc(0), meta: {} });
    await expect(
      ctx.service.apply(row.id, { actor: 'u1', via: 'card' }),
    ).rejects.toBeInstanceOf(ProposalNeedsRemoveConfirmError);
    expect(ctx.archive.apply).not.toHaveBeenCalled();

    ctx.archive.apply.mockResolvedValue({
      importId: 'imp1',
      mode: 'replace',
      written: 3,
      removed: 3,
      skipped: 1,
      failed: [],
      restartRequired: false,
    });
    const applied = await ctx.service.apply(row.id, { actor: 'u1', via: 'card', confirmRemove: true });
    expect(applied.status).toBe('applied');
    expect((applied.result as { written: number }).written).toBe(3);
    expect((applied.result as { restartRequired: boolean }).restartRequired).toBe(true);
  });
});
