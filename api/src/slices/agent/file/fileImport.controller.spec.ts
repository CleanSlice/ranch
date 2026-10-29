import {
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { IAgentGateway } from '#/agent/agent/domain';
import { IFileGateway } from './domain/file.gateway';
import { IArchiveEntry, IImportPlan } from './domain/import.types';
import { WorkspaceArchiveService } from './domain/workspaceArchive.service';
import { FileImportController } from './fileImport.controller';

const ZIP = Buffer.from('zip');

function planOf(remove: number): IImportPlan {
  return {
    importId: 'imp',
    mode: 'replace',
    includeSessions: false,
    wrapperStripped: null,
    counts: { add: 1, change: 0, unchanged: 0, remove, skip: 0 },
    totalBytes: 1,
    entries: [],
    more: 0,
    warnings: [],
  };
}

function build(
  opts: { stage?: boolean; remove?: number; status?: string } = {},
) {
  const agents = {
    findById: jest.fn(async (id: string) =>
      id === 'a1' ? { id, status: opts.status ?? 'running' } : null,
    ),
  } as unknown as IAgentGateway;
  const files = {
    getStage: jest.fn(async () =>
      opts.stage === false
        ? null
        : {
            zip: ZIP,
            meta: {
              agentId: 'a1',
              source: 'upload',
              size: 3,
              entries: 1,
              createdAt: new Date(),
            },
          },
    ),
    deleteStage: jest.fn(async () => undefined),
    putStage: jest.fn(async () => undefined),
    sweepStages: jest.fn(async () => 0),
  } as unknown as IFileGateway;
  let release: () => void = () => undefined;
  const applied = new Promise<void>((resolve) => {
    release = resolve;
  });
  const archives = {
    validate: jest.fn(async () => ({
      entries: [] as IArchiveEntry[],
      wrapperStripped: null,
    })),
    plan: jest.fn(async () => planOf(opts.remove ?? 0)),
    apply: jest.fn(async () => {
      await applied;
      return {
        importId: 'imp',
        mode: 'replace',
        written: 1,
        removed: opts.remove ?? 0,
        skipped: 0,
        failed: [],
        restartRequired: false,
      };
    }),
  } as unknown as WorkspaceArchiveService;
  const controller = new FileImportController(agents, files, archives);
  return { controller, files, archives, release };
}

// A person at the console; an agent token is refused before the plan is read.
const operator = () =>
  ({ user: { sub: 'user-1', email: '', roles: [] } }) as never;

describe('FileImportController', () => {
  it('answers 404 when the stage is gone', async () => {
    const { controller } = build({ stage: false });
    await expect(
      controller.plan('a1', 'imp', { mode: 'merge', includeSessions: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses replace with removals until confirmRemove is set', async () => {
    const { controller, archives } = build({ remove: 3 });
    const err = await controller
      .apply('a1', 'imp', { mode: 'replace' }, operator())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(409);
    expect((err as HttpException).getResponse()).toEqual({
      requiresConfirmation: true,
      remove: 3,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest mock behind the typed service
    expect(archives.apply).not.toHaveBeenCalled();
  });

  it('applies replace once confirmed, deletes the stage and reports restart', async () => {
    const { controller, files, release } = build({ remove: 3 });
    release();
    const result = await controller.apply(
      'a1',
      'imp',
      {
        mode: 'replace',
        confirmRemove: true,
      },
      operator(),
    );
    expect(result.removed).toBe(3);
    expect(result.restartRequired).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest mock behind the typed gateway
    expect(files.deleteStage).toHaveBeenCalledWith('a1', 'imp');
  });

  it('answers 409 while another import runs for the same agent', async () => {
    const { controller, release } = build();
    const first = controller.apply('a1', 'imp', { mode: 'merge' }, operator());
    // Let the first call reach `archives.apply` (it awaits the plan first).
    await new Promise((r) => setImmediate(r));
    await expect(
      controller.apply('a1', 'imp', { mode: 'merge' }, operator()),
    ).rejects.toBeInstanceOf(ConflictException);
    release();
    await first;
    // Lock released: a new import is accepted again.
    await expect(
      controller.apply('a1', 'imp', { mode: 'merge' }, operator()),
    ).resolves.toMatchObject({
      written: 1,
    });
  });

  it('answers 404 for an unknown agent', async () => {
    const { controller } = build();
    await expect(controller.plan('nope', 'imp', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ── Selected files (CLEAN-192) ──────────────────────────────────

const existing = [
  { path: 'SOUL.md', size: 10, etag: 'aaa' },
  { path: 'skills/a/SKILL.md', size: 20, etag: 'bbb' },
  { path: 'skills/b/SKILL.md', size: 30, etag: 'ccc' },
];

function buildFiles(
  opts: { kind?: 'archive' | 'files'; status?: string } = {},
) {
  const ctx = build({ status: opts.status });
  const files = ctx.files as unknown as Record<string, jest.Mock>;
  files.listWithEtags = jest.fn(async () => existing);
  files.getStage = jest.fn(async () => ({
    zip: Buffer.from('zip'),
    meta: {
      agentId: 'a1',
      source: 'upload',
      size: 3,
      entries: 1,
      createdAt: new Date(),
      kind: opts.kind ?? 'archive',
      ...(opts.kind === 'files'
        ? { expected: { 'SOUL.md': 'aaa', 'notes.md': null } }
        : {}),
    },
  }));
  (ctx.archives as unknown as Record<string, jest.Mock>).plan = jest.fn(
    async (_a: string, entries: unknown[], o: { mode: string }) => ({
      ...planOf(0),
      mode: o.mode,
      counts: {
        add: entries.length,
        change: 0,
        unchanged: 0,
        remove: 0,
        skip: 0,
      },
    }),
  );
  return ctx;
}

const upload = (name: string, body = 'x') => ({
  originalname: name,
  mimetype: 'text/plain',
  size: body.length,
  buffer: Buffer.from(body),
});

describe('FileImportController — selected files', () => {
  it('resolves names against the workspace without touching it', async () => {
    const { controller, files } = buildFiles();
    const res = await controller.resolve(
      'a1',
      { names: ['SOUL.md', 'SKILL.md', 'new.md'], targetFolder: 'docs/' },
      operator(),
    );
    expect(res.targetFolder).toBe('docs');
    expect(res.rows.map((r) => [r.name, r.match, r.path])).toEqual([
      ['SOUL.md', 'unique', 'SOUL.md'],
      ['SKILL.md', 'ambiguous', null],
      ['new.md', 'none', 'docs/new.md'],
    ]);
    expect(res.rows[1].candidates).toEqual([
      'skills/a/SKILL.md',
      'skills/b/SKILL.md',
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest mock behind the typed gateway
    expect(files.putStage).not.toHaveBeenCalled();
  });

  it('answers 404 on resolve for an unknown agent', async () => {
    const { controller } = buildFiles();
    await expect(
      controller.resolve('nope', { names: ['SOUL.md'] }, operator()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stages selected files as a files stage with the expected ETags and returns a merge plan', async () => {
    const { controller, files } = buildFiles();
    const plan = await controller.stageFiles(
      'a1',
      [upload('SOUL.md', 'new soul'), upload('notes.md', '')],
      {
        targets: JSON.stringify([
          { name: 'SOUL.md', path: 'SOUL.md' },
          { name: 'notes.md', path: 'notes.md' },
        ]),
      },
      operator(),
    );
    expect(plan.mode).toBe('merge');
    expect(plan.counts.add).toBe(2);
    const putStage = files.putStage as unknown as jest.Mock;
    expect(putStage).toHaveBeenCalledTimes(1);
    const [agentId, importId, zip, meta] = putStage.mock.calls[0] as [
      string,
      string,
      Buffer,
      Record<string, unknown>,
    ];
    expect(agentId).toBe('a1');
    expect(importId).toMatch(/[0-9a-f-]{36}/);
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(meta.kind).toBe('files');
    expect(meta.expected).toEqual({ 'SOUL.md': 'aaa', 'notes.md': null });
  });

  it('refuses a target outside the resolved set, a duplicate name and no files', async () => {
    const { controller, files } = buildFiles();
    await expect(
      controller.stageFiles(
        'a1',
        [upload('SOUL.md')],
        {
          targets: JSON.stringify([
            { name: 'SOUL.md', path: 'elsewhere/SOUL.md' },
          ]),
        },
        operator(),
      ),
    ).rejects.toThrow(/cannot go to/);
    await expect(
      controller.stageFiles(
        'a1',
        [upload('a.md'), upload('a.md')],
        { targets: JSON.stringify([{ name: 'a.md', path: 'a.md' }]) },
        operator(),
      ),
    ).rejects.toThrow(/duplicate name/);
    await expect(
      controller.stageFiles('a1', [], { targets: '[]' }, operator()),
    ).rejects.toThrow(/at least one/);
    await expect(
      controller.stageFiles(
        'a1',
        [upload('a.md')],
        { targets: 'nope' },
        operator(),
      ),
    ).rejects.toThrow(/not valid JSON/);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest mock behind the typed gateway
    expect(files.putStage).not.toHaveBeenCalled();
  });

  it('refuses replace on a files stage and passes the guard to apply in merge mode', async () => {
    const { controller, archives, release } = buildFiles({ kind: 'files' });
    release();
    await expect(
      controller.apply('a1', 'imp', { mode: 'replace' }, operator()),
    ).rejects.toThrow(/never remove/);
    await expect(
      controller.plan('a1', 'imp', { mode: 'replace' }),
    ).rejects.toThrow(/never remove/);
    const validate = archives.validate as unknown as jest.Mock;
    expect(validate).toHaveBeenLastCalledWith(expect.anything(), {
      stripWrapper: false,
    });
    await controller.apply('a1', 'imp', { mode: 'merge' }, operator());
    const apply = archives.apply as unknown as jest.Mock;
    expect(apply.mock.calls[0][3]).toEqual({
      'SOUL.md': 'aaa',
      'notes.md': null,
    });
  });

  it('keeps stripping the wrapper and passes no guard for an archive stage', async () => {
    const { controller, archives, release } = buildFiles({ kind: 'archive' });
    release();
    await controller.apply('a1', 'imp', { mode: 'merge' }, operator());
    const validate = archives.validate as unknown as jest.Mock;
    expect(validate).toHaveBeenLastCalledWith(expect.anything(), {
      stripWrapper: true,
    });
    const apply = archives.apply as unknown as jest.Mock;
    expect(apply.mock.calls[0][3]).toBeUndefined();
  });
});
