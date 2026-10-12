import { MigrationService } from './migration.service';
import { KnowledgeService } from '../../knowledge/domain/knowledge.service';
import { IKnowledgeGateway } from '../../knowledge/domain/knowledge.gateway';
import {
  IInstanceStatePatch,
  IKnowledgeRecord,
} from '../../knowledge/domain/knowledge.types';
import { KnowledgeMapper } from '../../knowledge/data/knowledge.mapper';
import { SourceService } from '../../source/domain/source.service';
import { ISourceCounts, ISourceData } from '../../source/domain/source.types';
import { IInstanceGateway } from '../../instance/domain/instance.gateway';
import { IInstanceStatus } from '../../instance/domain/instance.types';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';
import { LightragRequestConfig } from '../../lightrag/data/lightragHttp.client';
import { routeLightragConfig } from '../../lightrag/data/lightragRouting';

function record(id: string): IKnowledgeRecord {
  return {
    id,
    name: id,
    description: null,
    workspace: `knowledge_${id}`,
    indexStatus: 'idle',
    indexError: null,
    indexedAt: null,
    indexStartedAt: null,
    instanceState: 'absent',
    instanceError: null,
    instanceEndpoint: null,
    migrationState: 'notStarted',
    readerAccess: 'closed',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function makeConfig(isolation: boolean): IKnowledgeConfigGateway {
  return {
    isEnabled: jest.fn(() => Promise.resolve(true)),
    isInstanceIsolationEnabled: jest.fn(() => Promise.resolve(isolation)),
  } as unknown as IKnowledgeConfigGateway;
}

const SHARED: LightragRequestConfig = {
  url: 'http://lightrag.platform.svc:9621',
  apiKey: 'shared-key',
  enabled: true,
};

/**
 * A gateway that keeps rows the way the real one does: what `create` stores
 * is what the real mapper decided, so a test sees the state a base is
 * actually born with rather than one the test picked.
 */
function storingGateway(): { gateway: IKnowledgeGateway } {
  const mapper = new KnowledgeMapper();
  const rows = new Map<string, IKnowledgeRecord>();
  const patch = (id: string, change: Partial<IKnowledgeRecord>) => {
    const next = { ...record(id), ...rows.get(id), ...change };
    rows.set(id, next);
    return Promise.resolve(next);
  };
  const gateway = {
    create: jest.fn((...args: Parameters<IKnowledgeGateway['create']>) => {
      const input = mapper.toCreate(...args);
      const id = String(input.id);
      return patch(id, {
        name: input.name,
        migrationState: input.migrationState === 'done' ? 'done' : 'notStarted',
      });
    }),
    findById: jest.fn((id: string) => Promise.resolve(rows.get(id) ?? null)),
    updateInstanceState: jest.fn((id: string, change: IInstanceStatePatch) =>
      patch(id, change),
    ),
  } as unknown as IKnowledgeGateway;
  return { gateway };
}

function noSources(): SourceService {
  return {
    countByKnowledgeIds: jest.fn(() => Promise.resolve(new Map())),
  } as unknown as SourceService;
}

// The transition off the shared pool re-ingests every source through the LLM
// and provisions one retrieval instance per base. Deploying this code must
// not start any of that: it only happens once an operator flips
// knowledge/instance_isolation on.
describe('instance isolation opt-in gate', () => {
  test('migration does not even look at the bases while the flag is off', async () => {
    const findAll = jest.fn(() => Promise.resolve([record('k1')]));
    const knowledgeGateway = { findAll } as unknown as IKnowledgeGateway;
    const service = new MigrationService(
      knowledgeGateway,
      {} as KnowledgeService,
      {} as SourceService,
      {} as IInstanceGateway,
      makeConfig(false),
    );

    await service.runIfNeeded();

    expect(findAll).not.toHaveBeenCalled();
  });

  test('migration proceeds once the flag is on', async () => {
    const findAll = jest.fn(() => Promise.resolve<IKnowledgeRecord[]>([]));
    const knowledgeGateway = { findAll } as unknown as IKnowledgeGateway;
    const service = new MigrationService(
      knowledgeGateway,
      {} as KnowledgeService,
      {} as SourceService,
      {} as IInstanceGateway,
      makeConfig(true),
    );

    await service.runIfNeeded();

    expect(findAll).toHaveBeenCalled();
  });

  test('creating a base provisions no instance while the flag is off', async () => {
    const created = record('k-new');
    const gateway = {
      create: jest.fn(() => Promise.resolve(created)),
      findById: jest.fn(() => Promise.resolve(created)),
    } as unknown as IKnowledgeGateway;
    const sources = {
      countByKnowledgeIds: jest.fn(() => Promise.resolve(new Map())),
    } as unknown as SourceService;
    const ensureCapacityForNew = jest.fn();
    const provision = jest.fn();
    const instances = {
      ensureCapacityForNew,
      provision,
    } as unknown as IInstanceGateway;
    const service = new KnowledgeService(
      gateway,
      sources,
      instances,
      makeConfig(false),
    );

    const result = await service.create({ name: 'k-new' });

    expect(result.id).toBe('k-new');
    expect(ensureCapacityForNew).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });

  test('a base created while the flag is off writes to the shared pool', async () => {
    // CLEAN-144: it used to be born 'done' like a base of the isolated era,
    // with no instance to go with it, so the router refused every write and
    // each source failed with "Retrieval is not available for knowledge …".
    const { gateway } = storingGateway();
    const provision = jest.fn();
    const service = new KnowledgeService(
      gateway,
      noSources(),
      { provision } as unknown as IInstanceGateway,
      makeConfig(false),
    );

    const created = await service.create({ name: 'k-new' });

    expect(
      routeLightragConfig(SHARED, created, {
        knowledgeId: created.id,
        intent: 'write',
      }),
    ).toEqual(SHARED);
  });

  test('a base created while the flag is on never writes to the shared pool', async () => {
    const { gateway } = storingGateway();
    const starting: IInstanceStatus = {
      knowledgeId: 'k-new',
      state: 'starting',
      endpoint: null,
      error: null,
      observedAt: new Date(0).toISOString(),
    };
    const instances = {
      ensureCapacityForNew: jest.fn(() => Promise.resolve()),
      provision: jest.fn(() => Promise.resolve(starting)),
    } as unknown as IInstanceGateway;
    const service = new KnowledgeService(
      gateway,
      noSources(),
      instances,
      makeConfig(true),
    );

    const created = await service.create({ name: 'k-new' });

    expect(
      routeLightragConfig(SHARED, created, {
        knowledgeId: created.id,
        intent: 'write',
      }),
    ).toEqual({ url: '', apiKey: SHARED.apiKey, enabled: false });
  });

  test('start-up returns a base stranded without an instance to the shared pool while the flag is off', async () => {
    const stranded: IKnowledgeRecord = {
      ...record('k-stranded'),
      migrationState: 'done',
    };
    const isolated: IKnowledgeRecord = {
      ...record('k-isolated'),
      migrationState: 'done',
      instanceState: 'ready',
      instanceEndpoint: 'http://lightrag-kb-k-isolated.agents.svc:9621',
    };
    const updateMigrationState = jest.fn(() => Promise.resolve(stranded));
    const gateway = {
      findAll: jest.fn(() =>
        Promise.resolve([stranded, isolated, record('k-shared')]),
      ),
      updateMigrationState,
    } as unknown as IKnowledgeGateway;
    const service = new KnowledgeService(
      gateway,
      noSources(),
      {} as IInstanceGateway,
      makeConfig(false),
    );

    await service.reconcileInstances();

    expect(updateMigrationState.mock.calls).toEqual([
      ['k-stranded', 'notStarted'],
    ]);
  });

  test('start-up never moves a base that already holds indexed content', async () => {
    // A base stranded by CLEAN-144 could not take a single document, so it
    // has nothing indexed. One that does got its content somewhere, and
    // pointing it at the shared pool on a guess would have the next index
    // run pay to ingest all of it again.
    const indexed: IKnowledgeRecord = {
      ...record('k-indexed'),
      migrationState: 'done',
    };
    const updateMigrationState = jest.fn(() => Promise.resolve(indexed));
    const gateway = {
      findAll: jest.fn(() => Promise.resolve([indexed])),
      updateMigrationState,
    } as unknown as IKnowledgeGateway;
    const counts: ISourceCounts = {
      total: 756,
      indexed: 756,
      failed: 0,
      retrying: 0,
      processing: 0,
    };
    const sources = {
      countByKnowledgeIds: jest.fn(() =>
        Promise.resolve(new Map([['k-indexed', counts]])),
      ),
    } as unknown as SourceService;
    const service = new KnowledgeService(
      gateway,
      sources,
      {} as IInstanceGateway,
      makeConfig(false),
    );

    await service.reconcileInstances();

    expect(updateMigrationState).not.toHaveBeenCalled();
  });

  test('start-up provisions a base without an instance instead of releasing it while the flag is on', async () => {
    const waiting: IKnowledgeRecord = {
      ...record('k-waiting'),
      migrationState: 'done',
    };
    const updateMigrationState = jest.fn(() => Promise.resolve(waiting));
    const gateway = {
      findAll: jest.fn(() => Promise.resolve([waiting])),
      updateInstanceState: jest.fn(() => Promise.resolve(waiting)),
      updateMigrationState,
    } as unknown as IKnowledgeGateway;
    const provision = jest.fn(() =>
      Promise.resolve<IInstanceStatus>({
        knowledgeId: 'k-waiting',
        state: 'starting',
        endpoint: null,
        error: null,
        observedAt: new Date(0).toISOString(),
      }),
    );
    const instances = {
      list: jest.fn(() => Promise.resolve<IInstanceStatus[]>([])),
      provision,
    } as unknown as IInstanceGateway;
    const service = new KnowledgeService(
      gateway,
      {} as SourceService,
      instances,
      makeConfig(true),
    );

    await service.reconcileInstances();

    expect(provision).toHaveBeenCalledTimes(1);
    expect(updateMigrationState).not.toHaveBeenCalled();
  });

  test('start-up reconciliation touches no instances while the flag is off', async () => {
    const gateway = {
      findAll: jest.fn(() => Promise.resolve([record('k1')])),
    } as unknown as IKnowledgeGateway;
    const list = jest.fn(() => Promise.resolve<never[]>([]));
    const provision = jest.fn();
    const instances = { list, provision } as unknown as IInstanceGateway;
    const service = new KnowledgeService(
      gateway,
      {} as SourceService,
      instances,
      makeConfig(false),
    );

    await service.reconcileInstances();

    expect(list).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });

  test('an unmigrated base is queried even when its rows show nothing indexed', async () => {
    // Pre-migration rows can lag behind the shared index (a stamp lost to an
    // interrupted run). The emptiness veto must not silence a base LightRAG
    // still answers for — that veto starts only once the base is isolated.
    const base = record('k1');
    const source: ISourceData = {
      id: 'src-1',
      knowledgeId: 'k1',
      cited: 0,
      likes: 0,
      dislikes: 0,
      type: 'text',
      name: 'notes.txt',
      url: null,
      mimeType: null,
      content: 'text',
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
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const searchKnowledge = jest.fn(() =>
      Promise.resolve({ answer: 'from the shared pool', references: [] }),
    );
    const gateway = {
      findById: jest.fn(() => Promise.resolve(base)),
      searchKnowledge,
    } as unknown as IKnowledgeGateway;
    const sources = {
      findByKnowledge: jest.fn(() => Promise.resolve([source])),
      countByKnowledgeIds: jest.fn(() => Promise.resolve(new Map())),
    } as unknown as SourceService;
    const service = new KnowledgeService(
      gateway,
      sources,
      {} as IInstanceGateway,
      makeConfig(false),
    );

    const result = await service.query('k1', 'anything');

    expect(searchKnowledge).toHaveBeenCalled();
    expect(result.answer).toBe('from the shared pool');
  });
});
