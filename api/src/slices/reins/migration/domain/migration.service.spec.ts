import { MigrationService } from './migration.service';
import { KnowledgeService } from '../../knowledge/domain/knowledge.service';
import { IKnowledgeGateway } from '../../knowledge/domain/knowledge.gateway';
import { IKnowledgeData } from '../../knowledge/domain/knowledge.types';
import { SourceService } from '../../source/domain/source.service';
import { IInstanceGateway } from '../../instance/domain/instance.gateway';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';

function record(id: string): IKnowledgeData {
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
    isEnabled: jest.fn(async () => true),
    isInstanceIsolationEnabled: jest.fn(async () => isolation),
  } as unknown as IKnowledgeConfigGateway;
}

// The transition off the shared pool re-ingests every source through the LLM
// and provisions one retrieval instance per base. Deploying this code must
// not start any of that: it only happens once an operator flips
// knowledge/instance_isolation on.
describe('instance isolation opt-in gate', () => {
  test('migration does not even look at the bases while the flag is off', async () => {
    const knowledgeGateway = {
      findAll: jest.fn(async () => [record('k1')]),
    } as unknown as IKnowledgeGateway;
    const service = new MigrationService(
      knowledgeGateway,
      {} as KnowledgeService,
      {} as SourceService,
      {} as IInstanceGateway,
      makeConfig(false),
    );

    await service.runIfNeeded();

    expect(knowledgeGateway.findAll).not.toHaveBeenCalled();
  });

  test('migration proceeds once the flag is on', async () => {
    const knowledgeGateway = {
      findAll: jest.fn(async () => []),
    } as unknown as IKnowledgeGateway;
    const service = new MigrationService(
      knowledgeGateway,
      {} as KnowledgeService,
      {} as SourceService,
      {} as IInstanceGateway,
      makeConfig(true),
    );

    await service.runIfNeeded();

    expect(knowledgeGateway.findAll).toHaveBeenCalled();
  });

  test('creating a base provisions no instance while the flag is off', async () => {
    const created = record('k-new');
    const gateway = {
      create: jest.fn(async () => created),
      findById: jest.fn(async () => created),
    } as unknown as IKnowledgeGateway;
    const sources = {} as SourceService;
    const instances = {
      ensureCapacityForNew: jest.fn(),
      provision: jest.fn(),
    } as unknown as IInstanceGateway;
    const service = new KnowledgeService(
      gateway,
      sources,
      instances,
      makeConfig(false),
    );

    const result = await service.create({ name: 'k-new' });

    expect(result.id).toBe('k-new');
    expect(instances.ensureCapacityForNew).not.toHaveBeenCalled();
    expect(instances.provision).not.toHaveBeenCalled();
  });

  test('start-up reconciliation touches no instances while the flag is off', async () => {
    const gateway = {
      findAll: jest.fn(async () => [record('k1')]),
    } as unknown as IKnowledgeGateway;
    const instances = {
      list: jest.fn(async () => []),
      provision: jest.fn(),
    } as unknown as IInstanceGateway;
    const service = new KnowledgeService(
      gateway,
      {} as SourceService,
      instances,
      makeConfig(false),
    );

    await service.reconcileInstances();

    expect(instances.list).not.toHaveBeenCalled();
    expect(instances.provision).not.toHaveBeenCalled();
  });
});
