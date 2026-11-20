import type { ICallerParty } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import {
  accessSubject,
  AgentReach,
  type IAccessCaller,
} from '#/user/agentAccess/domain/agentAccess.types';
import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';
import type { IAgentReach } from '#/agent/agent/domain/agentPermission.service';
import { PeerAccessService } from '../peerAccess';

/**
 * For specs only: the real peer access rule over a spec's fake agents
 * (CLEAN-236).
 *
 * Every peer route and tool asks `PeerAccessService` what a connection is to
 * the caller, so a spec hands its own agents here and gets the real rule and
 * the real manage rule, never a stub that says yes. Who reaches what is one
 * map: the agents each account is denied. An account that is not in it
 * reaches every agent, and so does the Owner whatever it says.
 */
export interface IPeerWorld {
  /** Agent ids each account is denied, by user id. */
  denied?: Record<string, string[]>;
  /** The accounts a name or a hand-over's `for` may resolve to. */
  users?: Array<{
    id: string;
    name: string;
    role: UserRoleTypes;
    status?: string;
  }>;
}

export const OWNER: ICallerParty = {
  kind: 'person',
  userId: 'user-owner',
  role: UserRoleTypes.Owner,
};
export const ADMIN: ICallerParty = {
  kind: 'person',
  userId: 'user-admin',
  role: UserRoleTypes.Admin,
};
export const USER: ICallerParty = {
  kind: 'person',
  userId: 'user-user',
  role: UserRoleTypes.User,
};
export const TRUSTED: ICallerParty = { kind: 'trusted' };
export const GUEST: ICallerParty = { kind: 'guest' };

/** The accounts behind `OWNER`, `ADMIN` and `USER`. */
export const PEOPLE = [
  { id: 'user-owner', name: 'Olga Owner', role: UserRoleTypes.Owner },
  { id: 'user-admin', name: 'Adam Admin', role: UserRoleTypes.Admin },
  { id: 'user-user', name: 'Uma User', role: UserRoleTypes.User },
];

export function peerAccessOver(agents: unknown, world: IPeerWorld = {}) {
  const reachOf = (userId: string, role: UserRoleTypes): AgentReach =>
    role === UserRoleTypes.Owner
      ? AgentReach.ALL
      : new AgentReach({
          limited: false,
          entries: (world.denied?.[userId] ?? []).map((agentId) => ({
            agentId,
            list: 'denied' as const,
          })),
        } as never);

  const lists = {
    reachableIds: (caller: IAccessCaller) => {
      const subject = accessSubject(caller);
      return Promise.resolve(
        subject ? reachOf(subject.userId, subject.role) : AgentReach.ALL,
      );
    },
  };
  const agentReach: IAgentReach = {
    reaches: (person, agentId) =>
      Promise.resolve(reachOf(person.userId, person.role).has(agentId)),
  };
  const permission = permissionOver(agents, agentReach);
  const people = world.users ?? PEOPLE;
  const users = {
    findById: (id: string) => {
      const user = people.find((u) => u.id === id);
      return Promise.resolve(
        user ? { status: 'active', email: '', ...user } : null,
      );
    },
  };

  return {
    access: new PeerAccessService(lists as never, permission, users as never),
    permission,
    users,
  };
}
