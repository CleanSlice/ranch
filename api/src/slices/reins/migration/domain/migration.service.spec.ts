import { MigrationService } from './migration.service';
import { KnowledgeService } from '../../knowledge/domain/knowledge.service';
import { IKnowledgeGateway } from '../../knowledge/domain/knowledge.gateway';
import { IKnowledgeRecord } from '../../knowledge/domain/knowledge.types';
import { SourceService } from '../../source/domain/source.service';
import { ISourceData } from '../../source/domain/source.types';
import { IInstanceGateway } from '../../instance/domain/instance.gateway';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';

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
