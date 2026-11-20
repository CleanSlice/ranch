import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '#/setup/prisma/prisma.service';
import type { ISessionGateway } from '#/user/session/domain/session.gateway';
import { SessionService } from '#/user/session/domain/session.service';
import type { ISessionData } from '#/user/session/domain/session.types';
import { UserRoleTypes } from '#/user/user/domain';
import { ActingPartyService } from '../actingParty.service';

/**
 * A real `ActingPartyService` for specs: real `JwtService` with a test
 * secret and the real `SessionService.isLive`, over an in-memory session
 * table and user table. Shared by the specs that need a token that actually
 * verifies: the service's own, the effective caller's, and the hub's.
 */

export const ACTING_TEST_SECRET = 'acting-party-test-secret';

const HOUR_MS = 3_600_000;

interface IUserRow {
  id: string;
  role: string;
  status: string;
}

export function makeActingParty(secret: string = ACTING_TEST_SECRET) {
  const jwt = new JwtService({ secret });
  const sessions = new Map<string, ISessionData>();
  const users = new Map<string, IUserRow>();

  const sessionGateway = {
    findById: (id: string) => Promise.resolve(sessions.get(id) ?? null),
  } as unknown as ISessionGateway;
  const sessionService = new SessionService(sessionGateway, {
    get: () => undefined,
  } as unknown as ConfigService);
  const prisma = {
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(users.get(where.id) ?? null),
    },
  } as unknown as PrismaService;

  const service = new ActingPartyService(
    jwt,
    sessionGateway,
    sessionService,
    prisma,
  );

  /** An account, active unless said otherwise. */
  const addUser = (
    id: string,
    role: UserRoleTypes,
    status: string = 'active',
  ): IUserRow => {
    const row = { id, role, status };
    users.set(id, row);
    return row;
  };

  /** A live console session of `userId`, unless overridden. */
  const addSession = (
    id: string,
    userId: string,
    overrides: Partial<ISessionData> = {},
  ): ISessionData => {
    const now = Date.now();
    const row: ISessionData = {
      id,
      userId,
      secretHash: `hash-of-${id}`,
      expiresAt: new Date(now + 24 * HOUR_MS),
      absoluteExpiresAt: new Date(now + 240 * HOUR_MS),
      lastSeenAt: new Date(now),
      revokedAt: null,
      userAgent: null,
      surface: 'admin',
      createdAt: new Date(now),
      updatedAt: new Date(now),
      ...overrides,
    };
    sessions.set(id, row);
    return row;
  };

  /**
   * One signed-in person: the account, a live session, and what `mint`
   * needs to act for them at an agent.
   */
  const signIn = (
    userId: string,
    role: UserRoleTypes,
    sid: string = `sid-${userId}`,
  ) => {
    addUser(userId, role);
    addSession(sid, userId);
    return { userId, sid };
  };

  return { service, jwt, sessions, users, addUser, addSession, signIn };
}

/** The bearer an agent runtime presents: `issueAgentServiceToken`'s shape. */
export function agentBearer(agentId: string, isAdmin: boolean) {
  return {
    sub: `agent:${agentId}`,
    email: `agent-${agentId}@ranch.local`,
    roles: isAdmin ? [UserRoleTypes.Owner] : [UserRoleTypes.Agent],
  };
}
