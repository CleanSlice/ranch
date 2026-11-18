import { Prisma } from '@prisma/client';
import type { PrismaService } from '#/setup/prisma/prisma.service';
import { AgentPinGateway } from './agentPin.gateway';

/**
 * The pin gateway (CLEAN-231): one row per account and agent, written and
 * removed idempotently, and "no such agent" told apart from "done".
 */
function harness() {
  const agentPin = {
    upsert: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const agent = { findUnique: jest.fn().mockResolvedValue({ id: 'agent-a' }) };
  const gateway = new AgentPinGateway({
    agentPin,
    agent,
  } as unknown as PrismaService);
  return { gateway, agentPin, agent };
}

describe('AgentPinGateway', () => {
  it('pins with an upsert on the account-and-agent key, so twice is once', async () => {
    const { gateway, agentPin } = harness();
    expect(await gateway.pin('user-1', 'agent-a')).toBe(true);
    expect(await gateway.pin('user-1', 'agent-a')).toBe(true);
    expect(agentPin.upsert).toHaveBeenCalledWith({
      where: { userId_agentId: { userId: 'user-1', agentId: 'agent-a' } },
      create: { userId: 'user-1', agentId: 'agent-a' },
      update: {},
    });
  });

  it('answers false for an agent that does not exist, and lets other errors through', async () => {
    const { gateway, agentPin } = harness();
    agentPin.upsert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );
    expect(await gateway.pin('user-1', 'nope')).toBe(false);

    agentPin.upsert.mockRejectedValueOnce(new Error('database is down'));
    await expect(gateway.pin('user-1', 'agent-a')).rejects.toThrow(
      'database is down',
    );
  });

  it('unpins only this account’s pin, and says whether the agent exists', async () => {
    const { gateway, agentPin, agent } = harness();
    expect(await gateway.unpin('user-1', 'agent-a')).toBe(true);
    expect(agentPin.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', agentId: 'agent-a' },
    });
    agent.findUnique.mockResolvedValueOnce(null);
    expect(await gateway.unpin('user-1', 'nope')).toBe(false);
  });

  it('reads one account’s pins in one query', async () => {
    const { gateway, agentPin } = harness();
    agentPin.findMany.mockResolvedValueOnce([
      { agentId: 'agent-a' },
      { agentId: 'agent-b' },
    ]);
    expect([...(await gateway.pinnedIds('user-1'))]).toEqual([
      'agent-a',
      'agent-b',
    ]);
    expect(agentPin.findMany).toHaveBeenCalledTimes(1);
    expect(agentPin.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { agentId: true },
    });
    // Nobody has no pins, and costs no query.
    expect([...(await gateway.pinnedIds(''))]).toEqual([]);
    expect(agentPin.findMany).toHaveBeenCalledTimes(1);
  });

  it('removes every pin of a deleted account', async () => {
    const { gateway, agentPin } = harness();
    await gateway.removeUser('user-1');
    expect(agentPin.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });
});
