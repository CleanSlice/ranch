import { Subject } from 'rxjs';
import { AgentStatusService } from './agentStatus.service';
import { DeployTracker } from './deployTracker';
import type { IAgentData } from './agent.types';
import type { IAgentPodStatus } from '../../pod/domain';

/**
 * A healthy restart used to flash 'failed' (CLEAN-106).
 *
 * restartAgent marks a deploy cutoff and sets 'deploying'. For the seconds
 * Argo needs to reach the old pod, the OLD runtime is still on the bridle hub.
 * A drift sweep landing in that window read "connected" as "the agent is up",
 * wrote 'running' and dropped the cutoff. The old pod then exited cleanly on
 * SIGTERM, its phase turned Succeeded, nothing recognised the event as stale
 * any more, and the row was written 'failed' with "agent runtime exited" —
 * until the new pod came up and lifted it again.
 *
 * The real DeployTracker is used on purpose: the bug lived in how the service
 * and the tracker work together.
 */

const T0 = 1_800_000_000_000;

function makeBed() {
  const agent = {
    id: 'a1',
    name: 'Rancher',
    status: 'running',
    statusReason: null,
    workflowId: 'wf-old',
    lastDeployStartedAt: null,
  } as unknown as IAgentData;

  const writes: Array<{ status: string; reason?: string }> = [];
  const agentGateway = {
    findAll: jest.fn().mockImplementation(() => Promise.resolve([agent])),
    findById: jest.fn().mockImplementation(() => Promise.resolve(agent)),
    updateStatus: jest
      .fn()
      .mockImplementation(
        (_id: string, status: string, _wf?: string, reason?: string) => {
          (agent as { status: string }).status = status;
          writes.push({ status, reason });
          return Promise.resolve();
        },
      ),
    setStatusReason: jest.fn().mockResolvedValue(undefined),
    setLastPullAt: jest.fn().mockResolvedValue(undefined),
  };

  let pods: IAgentPodStatus[] = [];
  const podGateway = {
    list: jest.fn().mockImplementation(() => Promise.resolve(pods)),
    resync: jest.fn().mockResolvedValue(undefined),
    events$: jest.fn().mockReturnValue(new Subject()),
  };

  let connectedSince: number | null = null;
  const bridleGateway = {
    isAgentConnected: jest
      .fn()
      .mockImplementation(() => connectedSince !== null),
    agentConnectedSince: jest.fn().mockImplementation(() => connectedSince),
    agentEvents$: jest.fn().mockReturnValue(new Subject()),
  };

  const deployTracker = new DeployTracker();
  const service = new AgentStatusService(
    agentGateway as never,
    podGateway as never,
    { deploy: jest.fn() } as never,
    deployTracker,
    bridleGateway as never,
  );
  const internals = service as unknown as {
    detectDrift(reason: 'periodic'): Promise<string[]>;
    reconcileDbStatus(pod: IAgentPodStatus): Promise<void>;
  };

  return {
    agent,
    writes,
    deployTracker,
    setPods: (next: IAgentPodStatus[]) => (pods = next),
    runtimeOnHubSince: (at: number | null) => (connectedSince = at),
    sweep: () => internals.detectDrift('periodic'),
    podEvent: (pod: IAgentPodStatus) => internals.reconcileDbStatus(pod),
    /** What restartAgent + deploy() do to the row and the tracker. */
    beginRestart: () => {
      deployTracker.mark('a1');
      (agent as { status: string }).status = 'deploying';
      (agent as { lastDeployStartedAt: Date }).lastDeployStartedAt = new Date(
        Date.now(),
      );
    },
  };
}

function pod(overrides: Partial<IAgentPodStatus>): IAgentPodStatus {
  return {
    agentId: 'a1',
    podName: 'agent-a1',
    phase: 'Running',
    ready: true,
    restartCount: 0,
    startedAt: new Date(T0 - 60 * 60_000).toISOString(),
    terminating: false,
    lastTerminationReason: null,
    containerWaitingReason: null,
    message: null,
    observedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

describe('AgentStatusService — a restart while the old runtime is still on the hub', () => {
  let now: number;
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    now = T0;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => nowSpy.mockRestore());

  it('does not flash failed when a sweep lands before the old pod is gone', async () => {
    const bed = makeBed();
    const oldPod = pod({});
    bed.setPods([oldPod]);
    bed.runtimeOnHubSince(T0 - 60 * 60_000); // the runtime being replaced

    now = T0 + 1_000;
    bed.beginRestart();

    now = T0 + 6_000; // the 30 s sweep happens to fall inside the window
    await bed.sweep();
    expect(bed.agent.status).toBe('deploying');

    now = T0 + 12_000; // Argo deletes the old pod; the runtime exits 0
    await bed.podEvent(
      pod({ phase: 'Succeeded', ready: false, terminating: true }),
    );

    expect(bed.writes).toEqual([]);
    expect(bed.agent.status).toBe('deploying');
  });

  it('keeps the deploy cutoff, so the old pod stays stale even without the deletion flag', async () => {
    const bed = makeBed();
    bed.setPods([pod({})]);
    bed.runtimeOnHubSince(T0 - 60 * 60_000);

    now = T0 + 1_000;
    bed.beginRestart();
    now = T0 + 6_000;
    await bed.sweep();

    await bed.podEvent(pod({ phase: 'Succeeded', ready: false }));

    expect(bed.writes).toEqual([]);
  });

  it('still promotes once the NEW runtime joins the hub', async () => {
    const bed = makeBed();
    bed.runtimeOnHubSince(T0 - 60 * 60_000);
    now = T0 + 1_000;
    bed.beginRestart();

    now = T0 + 40_000;
    bed.runtimeOnHubSince(T0 + 35_000); // registered after the restart began
    bed.setPods([pod({ startedAt: new Date(T0 + 20_000).toISOString() })]);
    await bed.sweep();

    expect(bed.writes).toEqual([{ status: 'running', reason: undefined }]);
  });

  it('ignores the way out of a deleted pod after an API restart lost the cutoff', async () => {
    const bed = makeBed();
    (bed.agent as { status: string }).status = 'deploying';

    await bed.podEvent(
      pod({ phase: 'Failed', ready: false, terminating: true }),
    );

    expect(bed.writes).toEqual([]);
  });

  it('does not take a pod that is being deleted as proof the agent is up', async () => {
    const bed = makeBed();
    (bed.agent as { status: string }).status = 'deploying';

    await bed.podEvent(pod({ terminating: true }));

    expect(bed.writes).toEqual([]);
  });

  it('still reports a runtime that exited on its own', async () => {
    const bed = makeBed();

    await bed.podEvent(pod({ phase: 'Succeeded', ready: false }));

    expect(bed.writes).toEqual([
      {
        status: 'failed',
        reason: 'agent runtime exited — restart the agent to bring it back',
      },
    ]);
  });
});
