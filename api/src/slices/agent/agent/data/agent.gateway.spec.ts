import { AgentGateway } from './agent.gateway';
import { AgentStatusChanges, IAgentStatusChange } from '../domain';
import type { PrismaService } from '#/setup/prisma/prisma.service';
import type { AgentMapper } from './agent.mapper';

/**
 * updateStatus is the one write every status change passes through, and the
 * one place that announces it (CLEAN-139). Two things must hold: a real
 * transition is announced exactly once — also when two API replicas write the
 * same status in the same second — and a write that changes nothing about the
 * status still does what it did before (refresh the reason, the workflow id).
 */
function harness(movedCount: number) {
  const row = { id: 'agent-1', status: 'failed', statusReason: 'OOMKilled' };
  const agent = {
    updateMany: jest.fn().mockResolvedValue({ count: movedCount }),
    update: jest.fn().mockResolvedValue(row),
    findUniqueOrThrow: jest.fn().mockResolvedValue(row),
    delete: jest.fn().mockResolvedValue(row),
  };
  const changes = new AgentStatusChanges();
  const seen: IAgentStatusChange[] = [];
  changes.changes$().subscribe((c) => seen.push(c));
  const gateway = new AgentGateway(
    { agent } as unknown as PrismaService,
    { toEntity: (r: unknown) => r } as unknown as AgentMapper,
    changes,
  );
  return { gateway, agent, seen };
}

describe('AgentGateway.updateStatus', () => {
  it('announces a real transition once, with the status and the reason', async () => {
    const { gateway, agent, seen } = harness(1);

    await gateway.updateStatus('agent-1', 'failed', 'wf-1', 'OOMKilled');

    expect(agent.updateMany).toHaveBeenCalledWith({
      where: { id: 'agent-1', NOT: { status: 'failed' } },
      data: { status: 'failed', statusReason: 'OOMKilled', workflowId: 'wf-1' },
    });
    expect(agent.update).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0].agentId).toBe('agent-1');
    expect(seen[0].status).toBe('failed');
    expect(seen[0].reason).toBe('OOMKilled');
  });

  it('announces nothing when the status was already that, and still writes the reason', async () => {
    const { gateway, agent, seen } = harness(0);

    await gateway.updateStatus('agent-1', 'failed', undefined, 'new reason');

    expect(agent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { status: 'failed', statusReason: 'new reason' },
    });
    expect(seen).toHaveLength(0);
  });

  it('lets only the replica whose write changed the row announce it', async () => {
    const first = harness(1);
    const second = harness(0);

    await first.gateway.updateStatus('agent-1', 'failed', undefined, 'x');
    await second.gateway.updateStatus('agent-1', 'failed', undefined, 'x');

    expect(first.seen).toHaveLength(1);
    expect(second.seen).toHaveLength(0);
  });

  it('clears the reason on any status that is not a failure', async () => {
    const { gateway, agent, seen } = harness(1);

    await gateway.updateStatus('agent-1', 'running', undefined, 'ignored');

    expect(agent.updateMany.mock.calls[0][0].data).toEqual({
      status: 'running',
      statusReason: null,
    });
    expect(seen[0].reason).toBeNull();
  });

  it('clears the workflow id only when asked to with null', async () => {
    const { gateway, agent } = harness(1);

    await gateway.updateStatus('agent-1', 'stopped', null);

    expect(agent.updateMany.mock.calls[0][0].data).toEqual({
      status: 'stopped',
      statusReason: null,
      workflowId: null,
    });
  });
});

describe('AgentGateway.delete', () => {
  it('announces the agent going away', async () => {
    const { gateway, agent, seen } = harness(1);

    await gateway.delete('agent-1');

    expect(agent.delete).toHaveBeenCalledWith({ where: { id: 'agent-1' } });
    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe('deleted');
  });
});
