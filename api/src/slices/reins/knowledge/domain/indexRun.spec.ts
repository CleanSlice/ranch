import { ConflictException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { IKnowledgeGateway } from './knowledge.gateway';
import { IKnowledgeRecord } from './knowledge.types';
import { SourceService } from '../../source/domain/source.service';
import { IInstanceGateway } from '../../instance/domain/instance.gateway';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';

/**
 * Whether a base marked `indexing` can be indexed again. The row cannot tell
 * a running task from a dead one; the process can, because it holds the task.
 */

function record(overrides: Partial<IKnowledgeRecord> = {}): IKnowledgeRecord {
  return {
    id: 'k1',
    name: 'Mazda',
    description: null,
    workspace: 'k1',
    indexStatus: 'indexing',
    indexError: '17 source(s) failed: old.pdf (only whitespace)',
    indexedAt: new Date(0),
    // A minute ago: far inside any wait budget, so age alone would refuse.
    indexStartedAt: new Date(Date.now() - 60_000),
    instanceState: 'absent',
    instanceError: null,
    instanceEndpoint: null,
    migrationState: 'notStarted',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

interface Harness {
  service: KnowledgeService;
  updateIndexState: jest.Mock;
  /** Resolves the in-flight run's indexSources when called. */
  releaseRun: () => void;
}

function makeHarness(row: IKnowledgeRecord): Harness {
  let current = row;
  const updateIndexState = jest.fn(
    async (_id: string, patch: Partial<IKnowledgeRecord>) => {
      current = { ...current, ...patch };
      return current;
    },
  );
  const gateway = {
    findById: jest.fn(async () => current),
    findAll: jest.fn(async () => [current]),
    updateIndexState,
  } as unknown as IKnowledgeGateway;

  let releaseRun: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const sourceService = {
    findByKnowledge: jest.fn(async () => []),
    // The run blocks here until the test lets it go, which is what "a task
    // exists in this process" means.
    indexSources: jest.fn(async () => {
      await gate;
      return [];
    }),
    countByKnowledgeIds: jest.fn(async () => new Map()),
  } as unknown as SourceService;

  const service = new KnowledgeService(
    gateway,
    sourceService,
    {} as IInstanceGateway,
    {} as unknown as IKnowledgeConfigGateway,
  );
  return { service, updateIndexState, releaseRun };
}

describe('KnowledgeService.startIndex on a base already marked indexing', () => {
  it('restarts at once when no run exists in this process, whatever the age', async () => {
    const h = makeHarness(record());

    await expect(h.service.startIndex('k1')).resolves.toBeUndefined();

    // The dead run's leftovers go: status re-asserted, error cleared.
    expect(h.updateIndexState).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({ indexStatus: 'indexing', indexError: null }),
    );
    h.releaseRun();
  });

  it('refuses while the run it started is still executing', async () => {
    const h = makeHarness(record({ indexStatus: 'idle', indexError: null }));

    await h.service.startIndex('k1');
    // Second press while the first is blocked inside indexSources.
    await expect(h.service.startIndex('k1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    h.releaseRun();
  });

  it('reports the run as alive only while its task exists', async () => {
    const h = makeHarness(record({ indexStatus: 'idle', indexError: null }));

    await h.service.startIndex('k1');
    expect((await h.service.get('k1')).indexRunAlive).toBe(true);

    h.releaseRun();
    await h.service.waitForIndex('k1');
    // The finished run wrote a terminal status, so the flag is moot and
    // false, and a stale `indexing` row would read false too.
    expect((await h.service.get('k1')).indexRunAlive).toBe(false);
  });
});
