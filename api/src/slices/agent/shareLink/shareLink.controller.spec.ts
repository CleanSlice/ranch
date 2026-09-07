import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Request } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ShareLinkController } from './shareLink.controller';
import { ShareController } from './share.controller';
import {
  IShareLinkState,
  IShareResolved,
  ShareLinkErrorCodes,
  ShareLinkService,
} from './domain';
import { ShareResolveRequestDto } from './dtos';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';

const AGENT = 'agent-1';
const AGENT_NAME = 'Support bot';
const AGENT_STATUS = 'running';
const SUB = 'user-1';
const OTHER_SUB = 'user-2';

/** Same shape the service mints (`sl_` + 43 base64url chars). */
const TOKEN_RE = /^sl_[A-Za-z0-9_-]{43}$/;
const UNKNOWN_TOKEN = `sl_${'z'.repeat(43)}`;

const CREATED_AT = '2026-09-07T10:00:00.000Z';
const ROTATED_AT = '2026-09-07T10:10:00.000Z';
const REVOKED_AT = '2026-09-07T10:20:00.000Z';

interface IFakeRow {
  token: string;
  createdAt: string;
  revokedAt: string | null;
  rotatedAt: string | null;
  rotationCount: number;
  updatedBy: string;
}

/**
 * An in-memory stand-in for ShareLinkService. Every method is a jest.fn (so
 * the specs can assert what the controller forwarded) but it also *behaves*
 * like the real service — share is idempotent while active, regenerate always
 * rotates, revoke hides the token — because the controller contract the tasks
 * describe ("POST twice returns the same token", "POST after revoke returns a
 * new one") is only observable across several calls.
 */
function makeService() {
  const rows = new Map<string, IFakeRow>();
  const agents = new Map([[AGENT, { name: AGENT_NAME, status: AGENT_STATUS }]]);
  let minted = 0;

  // Deterministic, still `sl_` + 43 url-safe chars.
  const mint = () => `sl_${String(minted++).padStart(43, 'q')}`;

  const state = (row?: IFakeRow): IShareLinkState => {
    if (!row) {
      return {
        active: false,
        token: null,
        createdAt: null,
        revokedAt: null,
        rotatedAt: null,
        rotationCount: 0,
      };
    }
    const active = row.revokedAt === null;
    return {
      active,
      token: active ? row.token : null,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
      rotatedAt: row.rotatedAt,
      rotationCount: row.rotationCount,
    };
  };

  const requireAgent = (agentId: string): void => {
    if (!agents.has(agentId)) throw new NotFoundException('Agent not found');
  };

  const rotateOrCreate = (agentId: string, userId: string): IFakeRow => {
    const row = rows.get(agentId);
    if (!row) {
      const fresh: IFakeRow = {
        token: mint(),
        createdAt: CREATED_AT,
        revokedAt: null,
        rotatedAt: null,
        rotationCount: 0,
        updatedBy: userId,
      };
      rows.set(agentId, fresh);
      return fresh;
    }
    row.token = mint();
    row.revokedAt = null;
    row.rotatedAt = ROTATED_AT;
    row.rotationCount += 1;
    row.updatedBy = userId;
    return row;
  };

  const getState = jest.fn((agentId: string): Promise<IShareLinkState> => {
    requireAgent(agentId);
    return Promise.resolve(state(rows.get(agentId)));
  });

  const share = jest.fn(
    (agentId: string, userId: string): Promise<IShareLinkState> => {
      requireAgent(agentId);
      const row = rows.get(agentId);
      if (row && !row.revokedAt) return Promise.resolve(state(row));
      return Promise.resolve(state(rotateOrCreate(agentId, userId)));
    },
  );

  const regenerate = jest.fn(
    (agentId: string, userId: string): Promise<IShareLinkState> => {
      requireAgent(agentId);
      return Promise.resolve(state(rotateOrCreate(agentId, userId)));
    },
  );

  const revoke = jest.fn(
    (agentId: string, userId: string): Promise<IShareLinkState> => {
      requireAgent(agentId);
      const row = rows.get(agentId);
      if (!row || row.revokedAt) return Promise.resolve(state(row));
      row.revokedAt = REVOKED_AT;
      row.updatedBy = userId;
      return Promise.resolve(state(row));
    },
  );

  const resolveForVisitor = jest.fn(
    (token: string): Promise<IShareResolved> => {
      const notFound = new NotFoundException({
        code: ShareLinkErrorCodes.NotFound,
      });
      for (const [agentId, row] of rows) {
        if (row.token !== token || row.revokedAt) continue;
        const agent = agents.get(agentId);
        if (!agent) return Promise.reject(notFound);
        return Promise.resolve({
          agentId,
          agentName: agent.name,
          agentStatus: agent.status,
          // Deliberate extra key: the controller must not pass it through.
          secret: 'do-not-leak',
        } as unknown as IShareResolved);
      }
      return Promise.reject(notFound);
    },
  );

  const service = {
    getState,
    share,
    regenerate,
    revoke,
    resolveForVisitor,
  } as unknown as ShareLinkService;

  return { service, getState, share, regenerate, revoke, resolveForVisitor };
}

function makeControllers() {
  const stubs = makeService();
  return {
    ...stubs,
    owner: new ShareLinkController(stubs.service),
    visitor: new ShareController(stubs.service),
  };
}

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const req = (sub: string | null = SUB): AuthedRequest =>
  ({
    user: sub
      ? ({ sub, email: '', roles: [] } as IAuthTokenPayload)
      : undefined,
  }) as AuthedRequest;

/** Reject-and-return so the body of two failures can be compared byte for byte. */
async function rejection(
  run: () => Promise<unknown>,
): Promise<NotFoundException> {
  try {
    await run();
  } catch (err) {
    return err as NotFoundException;
  }
  throw new Error('expected the call to reject');
}

describe('ShareLinkController (owner side)', () => {
  it('returns the empty state for an agent that was never shared', async () => {
    const { owner } = makeControllers();
    await expect(owner.get(AGENT)).resolves.toEqual({
      active: false,
      token: null,
      createdAt: null,
      revokedAt: null,
      rotatedAt: null,
      rotationCount: 0,
    });
  });

  it('POST returns the same token twice for an active link', async () => {
    const { owner, share } = makeControllers();
    const first = await owner.create(AGENT, req());
    const second = await owner.create(AGENT, req());

    expect(first.token).toMatch(TOKEN_RE);
    expect(second.token).toBe(first.token);
    expect(second.active).toBe(true);
    expect(second.rotationCount).toBe(0);
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('GET reads back the link the owner just created', async () => {
    const { owner } = makeControllers();
    const created = await owner.create(AGENT, req());
    const read = await owner.get(AGENT);

    expect(read).toEqual(created);
    expect(read.createdAt).toBe(CREATED_AT);
  });

  it('returns exactly the documented ShareLinkDto fields', async () => {
    // The service state is poisoned with fields that must never reach the
    // wire — createdBy is an internal audit column, secret is nonsense.
    const poisoned = {
      getState: jest.fn(() =>
        Promise.resolve({
          active: true,
          token: `sl_${'q'.repeat(43)}`,
          createdAt: CREATED_AT,
          revokedAt: null,
          rotatedAt: null,
          rotationCount: 0,
          createdBy: SUB,
          secret: 'do-not-leak',
        } as unknown as IShareLinkState),
      ),
    } as unknown as ShareLinkService;

    const res = await new ShareLinkController(poisoned).get(AGENT);

    expect(Object.keys(res).sort()).toEqual([
      'active',
      'createdAt',
      'revokedAt',
      'rotatedAt',
      'rotationCount',
      'token',
    ]);
  });

  it('passes req.user.sub as the userId on every mutating route', async () => {
    const { owner, share, regenerate, revoke } = makeControllers();
    await owner.create(AGENT, req());
    expect(share).toHaveBeenCalledWith(AGENT, SUB);

    await owner.regenerate(AGENT, req(OTHER_SUB));
    expect(regenerate).toHaveBeenCalledWith(AGENT, OTHER_SUB);

    await owner.revoke(AGENT, req(OTHER_SUB));
    expect(revoke).toHaveBeenCalledWith(AGENT, OTHER_SUB);
  });

  it('refuses a request that carries no authenticated user', async () => {
    const { owner, share } = makeControllers();
    await expect(owner.create(AGENT, req(null))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(share).not.toHaveBeenCalled();
  });

  it('404s every route for an unknown agent', async () => {
    const { owner } = makeControllers();
    await expect(owner.get('nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(owner.create('nope', req())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(owner.regenerate('nope', req())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(owner.revoke('nope', req())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ShareLinkController rotation and revocation', () => {
  it('regenerate returns a different token and rotationCount + 1', async () => {
    const { owner } = makeControllers();
    const created = await owner.create(AGENT, req());
    const rotated = await owner.regenerate(AGENT, req());

    expect(rotated.token).toMatch(TOKEN_RE);
    expect(rotated.token).not.toBe(created.token);
    expect(rotated.rotationCount).toBe(created.rotationCount + 1);
    expect(rotated.active).toBe(true);
    expect(rotated.rotatedAt).toBe(ROTATED_AT);
  });

  it('revoke returns active: false and token: null', async () => {
    const { owner } = makeControllers();
    await owner.create(AGENT, req());
    const revoked = await owner.revoke(AGENT, req());

    expect(revoked.active).toBe(false);
    expect(revoked.token).toBeNull();
    expect(revoked.revokedAt).toBe(REVOKED_AT);
  });

  it('revoke twice resolves and is idempotent', async () => {
    const { owner } = makeControllers();
    await owner.create(AGENT, req());
    const once = await owner.revoke(AGENT, req());
    const twice = await owner.revoke(AGENT, req());

    expect(twice).toEqual(once);
  });

  it('POST after revoke returns a new token', async () => {
    const { owner } = makeControllers();
    const created = await owner.create(AGENT, req());
    await owner.revoke(AGENT, req());
    const reshared = await owner.create(AGENT, req());

    expect(reshared.active).toBe(true);
    expect(reshared.token).toMatch(TOKEN_RE);
    expect(reshared.token).not.toBe(created.token);
    expect(reshared.revokedAt).toBeNull();
  });
});

describe('ShareController.resolve (visitor side)', () => {
  it('returns exactly agentId, agentName and agentStatus', async () => {
    const { owner, visitor, resolveForVisitor } = makeControllers();
    const created = await owner.create(AGENT, req());
    const token = created.token as string;

    const res = await visitor.resolve({ token });

    expect(res).toEqual({
      agentId: AGENT,
      agentName: AGENT_NAME,
      agentStatus: AGENT_STATUS,
    });
    expect(Object.keys(res).sort()).toEqual([
      'agentId',
      'agentName',
      'agentStatus',
    ]);
    expect(resolveForVisitor).toHaveBeenCalledWith(token);
  });

  it('answers a revoked and an unknown token with identical 404s', async () => {
    const { owner, visitor } = makeControllers();
    const created = await owner.create(AGENT, req());
    const token = created.token as string;
    await owner.revoke(AGENT, req());

    const revoked = await rejection(() => visitor.resolve({ token }));
    const unknown = await rejection(() =>
      visitor.resolve({ token: UNKNOWN_TOKEN }),
    );

    expect(revoked).toBeInstanceOf(NotFoundException);
    expect(unknown).toBeInstanceOf(NotFoundException);
    expect(revoked.getStatus()).toBe(404);
    expect(unknown.getStatus()).toBe(revoked.getStatus());
    expect(revoked.getResponse()).toEqual({ code: 'SHARE_LINK_NOT_FOUND' });
    expect(unknown.getResponse()).toEqual(revoked.getResponse());
  });
});

describe('ShareResolveRequestDto', () => {
  const errorsFor = (token: unknown) =>
    validate(plainToInstance(ShareResolveRequestDto, { token }));

  it('accepts a well-formed share token', async () => {
    await expect(
      errorsFor('sl_mCV1jC5G3nre2dz7hEx7Y8PnbwfyZTVaTKJ8L2SAaDU'),
    ).resolves.toHaveLength(0);
  });

  it.each([
    ['no prefix', 'mCV1jC5G3nre2dz7hEx7Y8PnbwfyZTVaTKJ8L2SAaDU'],
    ['too short', `sl_${'a'.repeat(42)}`],
    ['too long', `sl_${'a'.repeat(44)}`],
    ['illegal character', `sl_${'a'.repeat(42)}$`],
    ['empty', ''],
  ])('rejects a token with %s', async (_label, token) => {
    await expect(errorsFor(token)).resolves.not.toHaveLength(0);
  });

  it('rejects a non-string token', async () => {
    await expect(errorsFor(42)).resolves.not.toHaveLength(0);
  });
});

describe('route status codes', () => {
  // Every share-link route answers 200, which is what @ApiOkResponse (and
  // therefore the generated SDK) promises — including the two POSTs, whose
  // Nest default would be 201. Both are idempotent: create usually hands back
  // a link that already existed, regenerate replaces one in place.
  // The handler is read off the prototype by name rather than referenced
  // directly, so no unbound method is ever passed around.
  const httpCode = (ctor: { prototype: object }, method: string): unknown => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      ctor.prototype,
      method,
    )?.value;
    return Reflect.getMetadata(HTTP_CODE_METADATA, handler as object);
  };

  const ROUTES: [string, { prototype: object }, string][] = [
    ['createAgentShareLink', ShareLinkController, 'create'],
    ['regenerateAgentShareLink', ShareLinkController, 'regenerate'],
    ['revokeAgentShareLink', ShareLinkController, 'revoke'],
    ['resolveShareLink', ShareController, 'resolve'],
  ];

  it.each(ROUTES)('%s answers 200', (_operationId, ctor, method) => {
    expect(httpCode(ctor, method)).toBe(200);
  });

  it('leaves GET on its default (no explicit @HttpCode)', () => {
    // Proves the assertions above are reading real metadata, not a constant.
    expect(httpCode(ShareLinkController, 'get')).toBeUndefined();
  });
});
