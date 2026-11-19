import { AgentGateway } from './agent.gateway';
import { AgentStatusChanges, IAgentStatusChange } from '../domain';
import type { PrismaService } from '#/setup/prisma/prisma.service';
import type { AgentMapper } from './agent.mapper';
import type { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import type { ICreateAgentData, IUpdateAgentData } from '../domain';

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
  // The transaction client is a different object from the plain one, so a
  // test can tell which of the two a write went through.
  const tx = {
    agent: { create: jest.fn().mockResolvedValue({ id: 'agent-new' }) },
  };
  const $transaction = jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
    run(tx),
  );
  const access = { allowCreated: jest.fn().mockResolvedValue(true) };
  const gateway = new AgentGateway(
    { agent, $transaction } as unknown as PrismaService,
    {
      toEntity: (r: unknown) => r,
      toCreate: (d: unknown) => d,
    } as unknown as AgentMapper,
    changes,
    access as unknown as AgentAccessService,
  );
  return { gateway, agent, seen, tx, $transaction, access };
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

describe('AgentGateway.create', () => {
  // The agent and its creator's allowed entry are one write (CLEAN-231): a
  // limited account that creates an agent must never be left without it.
  const data = (createdById?: string) =>
    ({ name: 'Support Bot', createdById }) as unknown as ICreateAgentData;

  it('allows the creator inside the transaction that creates the agent', async () => {
    const { gateway, agent, tx, $transaction, access } = harness(1);

    const out = await gateway.create(data('user-1'));

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.agent.create).toHaveBeenCalledWith({ data: data('user-1') });
    // The same client as the create, so both land or neither does.
    expect(access.allowCreated).toHaveBeenCalledWith(tx, 'user-1', 'agent-new');
    expect('create' in agent).toBe(false);
    expect(out).toEqual({ id: 'agent-new' });
  });

  it('writes no entry for an agent nobody is recorded as the creator of', async () => {
    const { gateway, tx, access } = harness(1);

    await gateway.create(data());

    expect(tx.agent.create).toHaveBeenCalledTimes(1);
    expect(access.allowCreated).not.toHaveBeenCalled();
  });

  it('fails as a whole when the entry cannot be written', async () => {
    const { gateway, access } = harness(1);
    access.allowCreated.mockRejectedValue(new Error('entry refused'));

    await expect(gateway.create(data('user-1'))).rejects.toThrow(
      'entry refused',
    );
  });
});

describe('AgentGateway.update', () => {
  // The pin is no longer a column of the agent (CLEAN-231): it is personal
  // and lives with the person. The general update must not write it, even
  // for a payload that still carries the key past the type.
  it('never writes pinned, even when a payload still carries it', async () => {
    const { gateway, agent } = harness(1);
    await gateway.update('agent-1', {
      name: 'Renamed',
      pinned: true,
    } as unknown as IUpdateAgentData);
    const data = agent.update.mock.calls[0][0].data;
    expect(data).toEqual({ name: 'Renamed' });
    expect('pinned' in data).toBe(false);
  });

  it('leaves pinned alone when the payload does not mention it', async () => {
    const { gateway, agent } = harness(1);
    await gateway.update('agent-1', { name: 'Renamed' });
    const data = agent.update.mock.calls[0][0].data;
    expect(data).toEqual({ name: 'Renamed' });
    expect('pinned' in data).toBe(false);
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
