import { Subject } from 'rxjs';
import { AgentStatusService } from './agentStatus.service';
import { IAgentData } from './agent.types';
import { IAgentPodStatus } from '#/agent/pod/domain/pod.types';

const BASE_NOW = 1_756_000_000_000;

function makeAgent(overrides: Partial<IAgentData> = {}): IAgentData {
  return {
    id: 'a1',
    name: 'Test agent',
    templateId: 't1',
    llmCredentialId: null,
    status: 'running',
    statusReason: null,
    workflowId: 'wf1',
    firstDeployedAt: new Date(BASE_NOW - 60 * 60_000),
    // Old enough to be far outside the 5-minute deploy grace window.
    lastDeployStartedAt: new Date(BASE_NOW - 60 * 60_000),
    lastPullAt: null,
    lastSyncAt: null,
    launchContext: 'restart',
    config: {},
    resources: { cpu: '1', memory: '1Gi' },
    debugEnabled: false,
    isPublic: false,
    allowedOrigins: [],
    knowledgeIds: [],
    isAdmin: false,
    createdAt: new Date(BASE_NOW - 120 * 60_000),
    updatedAt: new Date(BASE_NOW - 60 * 60_000),
    ...overrides,
  };
}

function makePod(overrides: Partial<IAgentPodStatus> = {}): IAgentPodStatus {
  return {
    agentId: 'a1',
    podName: 'agent-a1',
    phase: 'Running',
    ready: true,
    restartCount: 0,
    startedAt: new Date(BASE_NOW - 30 * 60_000).toISOString(),
    lastTerminationReason: null,
    containerWaitingReason: null,
    message: null,
    observedAt: new Date(BASE_NOW).toISOString(),
    ...overrides,
  } as IAgentPodStatus;
}

interface ITestBed {
  service: AgentStatusService;
  agentGateway: {
    findAll: jest.Mock;
    findById: jest.Mock;
    updateStatus: jest.Mock;
    setStatusReason: jest.Mock;
  };
  podGateway: {
    list: jest.Mock;
    resync: jest.Mock;
    events$: jest.Mock;
  };
  bridleGateway: {
    isAgentConnected: jest.Mock;
    agentEvents$: jest.Mock;
  };
  deployTracker: { mark: jest.Mock; clear: jest.Mock; isStale: jest.Mock };
}

function createTestBed(agents: IAgentData[], pods: IAgentPodStatus[]): ITestBed {
  const agentGateway = {
    findAll: jest.fn().mockResolvedValue(agents),
    findById: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(agents.find((a) => a.id === id) ?? null),
      ),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    setStatusReason: jest.fn().mockResolvedValue(undefined),
    setLastPullAt: jest.fn().mockResolvedValue(undefined),
  };
  const podGateway = {
    list: jest.fn().mockResolvedValue(pods),
    resync: jest.fn().mockResolvedValue(undefined),
    events$: jest.fn().mockReturnValue(new Subject()),
  };
  const bridleGateway = {
    isAgentConnected: jest.fn().mockReturnValue(false),
    agentEvents$: jest.fn().mockReturnValue(new Subject()),
  };
  const deployTracker = {
    mark: jest.fn(),
    clear: jest.fn(),
    isStale: jest.fn().mockReturnValue(false),
  };
  const agentDeployService = { deploy: jest.fn() };

  const service = new AgentStatusService(
    agentGateway as never,
    podGateway as never,
    agentDeployService as never,
    deployTracker as never,
    bridleGateway as never,
  );
  return { service, agentGateway, podGateway, bridleGateway, deployTracker };
}

function sweep(service: AgentStatusService): Promise<string[]> {
  return (
    service as unknown as {
      detectDrift(reason: 'startup' | 'periodic'): Promise<string[]>;
    }
  ).detectDrift('periodic');
}

describe('AgentStatusService bridle connectivity', () => {
  let nowSpy: jest.SpyInstance<number, []>;
  let now: number;

  beforeEach(() => {
    now = BASE_NOW;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('demotes running agent to unreachable after the grace window', async () => {
    const bed = createTestBed([makeAgent()], [makePod()]);

    await sweep(bed.service); // first observation — starts the window
    expect(bed.agentGateway.updateStatus).not.toHaveBeenCalled();

    now += 61_000;
    await sweep(bed.service);
    expect(bed.agentGateway.updateStatus).toHaveBeenCalledTimes(1);
    const [id, status, , reason] = bed.agentGateway.updateStatus.mock.calls[0];
    expect(id).toBe('a1');
    expect(status).toBe('unreachable');
    expect(reason).toContain('bridle hub');
    expect(reason).toContain('/settings/bridle');
  });

  test('does not demote while still inside the grace window', async () => {
    const bed = createTestBed([makeAgent()], [makePod()]);

    await sweep(bed.service);
    now += 30_000;
    await sweep(bed.service);
    expect(bed.agentGateway.updateStatus).not.toHaveBeenCalled();
  });

  test('does not demote while inside the deploy grace period', async () => {
    const agent = makeAgent({
      lastDeployStartedAt: new Date(BASE_NOW - 60_000), // 1 min ago
    });
    const bed = createTestBed([agent], [makePod()]);

    await sweep(bed.service);
    now += 61_000;
    await sweep(bed.service);
    expect(bed.agentGateway.updateStatus).not.toHaveBeenCalled();
  });

  test('leaves stopped agents untouched even with a live pod and no hub connection', async () => {
    const bed = createTestBed([makeAgent({ status: 'stopped' })], [makePod()]);

    await sweep(bed.service);
    now += 61_000;
    await sweep(bed.service);
    expect(bed.agentGateway.updateStatus).not.toHaveBeenCalled();
  });

  test('bridle registration promotes unreachable back to running and clears the window', async () => {
    const bed = createTestBed([makeAgent({ status: 'unreachable' })], []);
    const internal = bed.service as unknown as {
      bridleDownSince: Map<string, number>;
      markRunningFromBridle(agentId: string): Promise<void>;
    };
    internal.bridleDownSince.set('a1', BASE_NOW - 10_000);

    await internal.markRunningFromBridle('a1');

    expect(bed.agentGateway.updateStatus).toHaveBeenCalledWith(
      'a1',
      'running',
      'wf1',
    );
    expect(internal.bridleDownSince.has('a1')).toBe(false);
  });

  test('pod Running+Ready does NOT promote an unreachable agent', async () => {
    const bed = createTestBed([makeAgent({ status: 'unreachable' })], []);
    const internal = bed.service as unknown as {
      reconcileDbStatus(pod: IAgentPodStatus): Promise<void>;
    };

    await internal.reconcileDbStatus(makePod());

    expect(bed.agentGateway.updateStatus).not.toHaveBeenCalled();
  });

  test('unreachable agent whose pod disappears is marked failed', async () => {
    const bed = createTestBed([makeAgent({ status: 'unreachable' })], []);

    await sweep(bed.service);

    expect(bed.agentGateway.updateStatus).toHaveBeenCalledWith(
      'a1',
      'failed',
      'wf1',
      'agent pod disappeared',
    );
  });

  test('snapshot carries live bridleConnected per agent', async () => {
    const bed = createTestBed(
      [makeAgent({ id: 'a1' }), makeAgent({ id: 'a2', name: 'Second' })],
      [makePod({ agentId: 'a1' })],
    );
    bed.bridleGateway.isAgentConnected.mockImplementation(
      (id: string) => id === 'a1',
    );

    const snapshot = await bed.service.snapshot();

    expect(snapshot).toHaveLength(2);
    expect(
      snapshot.find((s) => s.agent.id === 'a1')?.bridleConnected,
    ).toBe(true);
    expect(
      snapshot.find((s) => s.agent.id === 'a2')?.bridleConnected,
    ).toBe(false);
  });
});
