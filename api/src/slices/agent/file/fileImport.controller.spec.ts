import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
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

function build(opts: { stage?: boolean; remove?: number; status?: string } = {}) {
  const agents = {
    findById: jest.fn(async (id: string) =>
      id === 'a1' ? { id, status: opts.status ?? 'running' } : null,
    ),
  } as unknown as IAgentGateway;
  const files = {
    getStage: jest.fn(async () =>
      opts.stage === false
        ? null
        : { zip: ZIP, meta: { agentId: 'a1', source: 'upload', size: 3, entries: 1, createdAt: new Date() } },
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
      .apply('a1', 'imp', { mode: 'replace' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(409);
    expect((err as HttpException).getResponse()).toEqual({
      requiresConfirmation: true,
      remove: 3,
    });
    expect(archives.apply).not.toHaveBeenCalled();
  });

  it('applies replace once confirmed, deletes the stage and reports restart', async () => {
    const { controller, files, release } = build({ remove: 3 });
    release();
    const result = await controller.apply('a1', 'imp', {
      mode: 'replace',
      confirmRemove: true,
    });
    expect(result.removed).toBe(3);
    expect(result.restartRequired).toBe(true);
    expect(files.deleteStage).toHaveBeenCalledWith('a1', 'imp');
  });

  it('answers 409 while another import runs for the same agent', async () => {
    const { controller, release } = build();
    const first = controller.apply('a1', 'imp', { mode: 'merge' });
    // Let the first call reach `archives.apply` (it awaits the plan first).
    await new Promise((r) => setImmediate(r));
    await expect(
      controller.apply('a1', 'imp', { mode: 'merge' }),
    ).rejects.toBeInstanceOf(ConflictException);
    release();
    await first;
    // Lock released: a new import is accepted again.
    await expect(controller.apply('a1', 'imp', { mode: 'merge' })).resolves.toMatchObject({
      written: 1,
    });
  });

  it('answers 404 for an unknown agent', async () => {
    const { controller } = build();
    await expect(
      controller.plan('nope', 'imp', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
