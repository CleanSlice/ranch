import { ApiInstanceService } from '#/setting/domain/apiInstance.service';
import { IAgentGateway } from './agent.gateway';
import {
  AgentToolStateService,
  TOOL_ALERT_REPEAT_MS,
} from './agentToolState.service';
import { IToolAlert } from './toolState.types';

const NOW = Date.parse('2026-11-20T09:20:00.000Z');
const ALERT_MS = 5 * 60_000;

const report = (phase: string, state = 'retrying') => ({
  phase,
  since: new Date(NOW).toISOString(),
  startedAt: new Date(NOW - 60_000).toISOString(),
  servers: [
    {
      id: 'mcp-documents',
      name: 'Documents',
      state: phase === 'ready' ? 'connected' : state,
      since: new Date(NOW).toISOString(),
      attempts: phase === 'ready' ? 0 : 3,
      lastError: 'HTTP 503',
    },
  ],
});

function build(opts: { status?: string; liveApis?: number } = {}) {
  const live = { count: opts.liveApis ?? 1 };
  const agent = { status: opts.status ?? 'running' };
  const agents = {
    findById: jest.fn(async (id: string) => ({ id, name: 'Maya', ...agent })),
  } as unknown as IAgentGateway;
  const apiInstances = {
    liveCount: jest.fn(async () => live.count),
  } as unknown as ApiInstanceService;
  const service = new AgentToolStateService(agents, apiInstances);
  const changes: string[] = [];
  const alerts: IToolAlert[] = [];
  service.changes$().subscribe((id) => changes.push(id));
  service.alerts$().subscribe((alert) => alerts.push(alert));
  return { service, changes, alerts, live, agent };
}

describe('AgentToolStateService', () => {
  beforeEach(() => {
    delete process.env.TOOLS_LIMITED_ALERT_MS;
  });

  it('accept keeps the report and says when the summary moved', () => {
    const { service, changes } = build();
    expect(service.summary('a1')).toBeNull();
    expect(service.accept('a1', report('connecting'), NOW)).toBe('connecting');
    expect(service.accept('a1', report('connecting'), NOW + 1)).toBe(
      'connecting',
    );
    expect(service.accept('a1', report('limited'), NOW + 2)).toBe('limited');
    expect(service.accept('a1', report('ready'), NOW + 3)).toBeNull();
    expect(changes).toEqual(['a1', 'a1', 'a1']);
    expect(service.detail('a1')?.servers[0].name).toBe('Documents');
  });

  it('an invalid report changes nothing', () => {
    const { service, changes } = build();
    service.accept('a1', report('limited'), NOW);
    expect(service.accept('a1', { phase: 'broken' }, NOW + 1)).toBe('limited');
    expect(service.accept('a2', 'nonsense', NOW + 1)).toBeNull();
    expect(changes).toEqual(['a1']);
    expect(service.detail('a2')).toBeNull();
  });

  it('clear forgets the agent and says so only when there was something to say', () => {
    const { service, changes } = build();
    service.accept('a1', report('ready'), NOW);
    service.clear('a1');
    service.clear('never-seen');
    expect(changes).toEqual([]);
    service.accept('a1', report('limited'), NOW);
    service.clear('a1');
    expect(changes).toEqual(['a1', 'a1']);
    expect(service.summary('a1')).toBeNull();
    expect(service.detail('a1')).toBeNull();
  });

  it('alerts after the threshold, once per stretch, with names and no error', async () => {
    const { service, alerts } = build();
    service.accept('a1', report('limited'), NOW);
    expect(await service.sweep(NOW + ALERT_MS - 1)).toBe(0);
    expect(await service.sweep(NOW + ALERT_MS)).toBe(1);
    expect(await service.sweep(NOW + ALERT_MS + 30_000)).toBe(0);
    // A fresh report of the same phase does not restart the count.
    service.accept('a1', report('limited'), NOW + ALERT_MS + 40_000);
    expect(await service.sweep(NOW + ALERT_MS + 60_000)).toBe(0);
    expect(alerts).toEqual([
      {
        kind: 'limited',
        agentId: 'a1',
        reason: 'Documents not connected for 5 min',
        at: new Date(NOW + ALERT_MS),
      },
    ]);
  });

  it('says it again while the agent stays limited, so the incident does not close over it', async () => {
    const { service, alerts } = build();
    service.accept('a1', report('limited'), NOW);
    await service.sweep(NOW + ALERT_MS);
    expect(await service.sweep(NOW + ALERT_MS + TOOL_ALERT_REPEAT_MS)).toBe(1);
    expect(alerts.map((a) => a.kind)).toEqual(['limited', 'limited']);
  });

  it('the threshold is a setting', async () => {
    process.env.TOOLS_LIMITED_ALERT_MS = '1000';
    const { service } = build();
    service.accept('a1', report('limited'), NOW);
    expect(await service.sweep(NOW + 1_000)).toBe(1);
  });

  it('connecting is never an alert', async () => {
    const { service } = build();
    service.accept('a1', report('connecting'), NOW);
    expect(await service.sweep(NOW + ALERT_MS * 10)).toBe(0);
  });

  it('quiet with two copies of the API alive', async () => {
    const { service, alerts, live } = build({ liveApis: 2 });
    service.accept('a1', report('limited'), NOW);
    expect(await service.sweep(NOW + ALERT_MS)).toBe(0);
    live.count = 1;
    expect(await service.sweep(NOW + ALERT_MS + 30_000)).toBe(1);
    expect(alerts).toHaveLength(1);
  });

  it.each(['stopped', 'pending', 'deploying'])(
    'quiet while the agent is %s',
    async (status) => {
      const { service, agent } = build({ status });
      service.accept('a1', report('limited'), NOW);
      expect(await service.sweep(NOW + ALERT_MS)).toBe(0);
      agent.status = 'running';
      expect(await service.sweep(NOW + ALERT_MS + 30_000)).toBe(1);
    },
  );

  it('announces the recovery of an agent it alerted about, and of no other', async () => {
    const { service, alerts } = build();
    service.accept('a1', report('limited'), NOW);
    service.accept('a2', report('limited'), NOW + ALERT_MS - 10);
    await service.sweep(NOW + ALERT_MS);
    service.accept('a1', report('ready'), NOW + ALERT_MS + 5);
    service.accept('a2', report('ready'), NOW + ALERT_MS + 5);
    expect(alerts.map((a) => `${a.kind}:${a.agentId}`)).toEqual([
      'limited:a1',
      'recovered:a1',
    ]);
  });

  it('a socket that went is not a recovery', async () => {
    const { service, alerts } = build();
    service.accept('a1', report('limited'), NOW);
    await service.sweep(NOW + ALERT_MS);
    service.clear('a1');
    expect(alerts.map((a) => a.kind)).toEqual(['limited']);
  });
});
