import type { IUserGateway } from '#/user/user/domain/user.gateway';
import { UserRoleTypes, type IUserData } from '#/user/user/domain/user.types';
import {
  IAgentAccessGateway,
  IAgentAccessTx,
  IAgentAccessWrite,
} from '../agentAccess.gateway';
import { AgentAccessService } from '../agentAccess.service';
import type {
  IAgentAccessEntry,
  IAgentAccessState,
} from '../agentAccess.types';

/**
 * For specs only: the access lists in memory, behaving as the Prisma
 * gateway does where it matters. One row per account and agent (a Map keyed
 * by agent id, as the primary key is), entries that go with their agent,
 * a version that moves on every write, and one edit of an account at a time.
 */
export class MemoryAgentAccessGateway extends IAgentAccessGateway {
  agents = new Set<string>();
  private rows = new Map<
    string,
    {
      limited: boolean;
      updatedAt: Date;
      entries: Map<string, IAgentAccessEntry>;
    }
  >();
  private locks = new Map<string, Promise<unknown>>();
  private clock = Date.parse('2026-11-17T10:00:00.000Z');

  constructor(agentIds: string[] = []) {
    super();
    for (const id of agentIds) this.agents.add(id);
  }

  /** Put a state in place without going through the service. */
  seed(userId: string, limited: boolean, entries: IAgentAccessEntry[]): void {
    this.rows.set(userId, {
      limited,
      updatedAt: new Date((this.clock += 1000)),
      entries: new Map(entries.map((e) => [e.agentId, { ...e }])),
    });
  }

  /** The agent is deleted: the cascade removes its entries, nothing else. */
  deleteAgent(agentId: string): void {
    this.agents.delete(agentId);
    for (const row of this.rows.values()) row.entries.delete(agentId);
  }

  load(userId: string): Promise<IAgentAccessState> {
    const row = this.rows.get(userId);
    return Promise.resolve(
      row
        ? {
            userId,
            limited: row.limited,
            entries: [...row.entries.values()].map((e) => ({ ...e })),
            updatedAt: row.updatedAt,
          }
        : { userId, limited: false, entries: [], updatedAt: null },
    );
  }

  async loadMany(userIds: string[]): Promise<Map<string, IAgentAccessState>> {
    const out = new Map<string, IAgentAccessState>();
    for (const id of userIds) out.set(id, await this.load(id));
    return out;
  }

  agentIds(): Promise<string[]> {
    return Promise.resolve([...this.agents]);
  }

  agentExists(agentId: string): Promise<boolean> {
    return Promise.resolve(this.agents.has(agentId));
  }

  transaction<T>(
    userId: string,
    fn: (tx: IAgentAccessTx) => Promise<T>,
  ): Promise<T> {
    const tx: IAgentAccessTx = {
      load: () => this.load(userId),
      agentIds: () => this.agentIds(),
      save: (next) => this.save(userId, next),
    };
    // The account's lock: the next edit starts when this one has ended,
    // whether it saved or refused.
    const previous = this.locks.get(userId) ?? Promise.resolve();
    const run = previous.then(
      () => fn(tx),
      () => fn(tx),
    );
    this.locks.set(
      userId,
      run.catch(() => undefined),
    );
    return run;
  }

  allowCreated(
    _tx: unknown,
    userId: string,
    agentId: string,
  ): Promise<boolean> {
    this.agents.add(agentId);
    const row = this.rows.get(userId);
    if (!row?.limited) return Promise.resolve(false);
    row.entries.set(agentId, { agentId, list: 'allowed' });
    row.updatedAt = new Date((this.clock += 1000));
    return Promise.resolve(true);
  }

  removeUser(userId: string): Promise<void> {
    this.rows.delete(userId);
    return Promise.resolve();
  }

  private save(
    userId: string,
    next: IAgentAccessWrite,
  ): Promise<IAgentAccessState> {
    this.rows.set(userId, {
      limited: next.limited,
      updatedAt: new Date((this.clock += 1000)),
      entries: new Map(next.entries.map((e) => [e.agentId, { ...e }])),
    });
    return this.load(userId);
  }
}

export const OWNER = { id: 'user-owner', role: UserRoleTypes.Owner };
export const ADMIN = { id: 'user-admin', role: UserRoleTypes.Admin };
export const ADMIN2 = { id: 'user-admin2', role: UserRoleTypes.Admin };
export const USER = { id: 'user-user', role: UserRoleTypes.User };
export const USER2 = { id: 'user-user2', role: UserRoleTypes.User };

const PEOPLE = [OWNER, ADMIN, ADMIN2, USER, USER2];

export function usersGateway(
  people: { id: string; role: UserRoleTypes }[] = PEOPLE,
): IUserGateway {
  return {
    findById: (id: string) =>
      Promise.resolve(
        (people.find((p) => p.id === id) as IUserData | undefined) ?? null,
      ),
    findAll: () => Promise.resolve(people as IUserData[]),
  } as unknown as IUserGateway;
}

/** A service over an in-memory gateway holding agents A, B and C. */
export function accessHarness(agentIds: string[] = ['A', 'B', 'C']) {
  const gateway = new MemoryAgentAccessGateway(agentIds);
  const service = new AgentAccessService(gateway, usersGateway());
  return { gateway, service };
}

/** A person as a caller of `reaches`, and as an editor of `replace`. */
export const person = (p: { id: string; role: UserRoleTypes }) => ({
  kind: 'person' as const,
  userId: p.id,
  role: p.role,
});

/**
 * An `AgentAccessService` that hides nothing: for the specs of tools and
 * controllers that are about something else.
 */
export function openAccess(): AgentAccessService {
  return new AgentAccessService(new MemoryAgentAccessGateway(), usersGateway());
}
