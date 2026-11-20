import {
  clientIdFromJwtPayload,
  hasShareToken,
  headerValue,
  isReservedClientId,
  parseBearer,
  resolveShareIdentity,
} from './chatIdentity';

/**
 * These four functions are the single definition of "who is talking" for the
 * HTTP routes, the attachment guard, the transcript routes and the websocket
 * handshake. Every subtlety that used to be re-decided (and mis-decided) per
 * call site is pinned here so the next copy never appears.
 */

describe('parseBearer', () => {
  it('reads the token out of a bearer header, case-insensitively', () => {
    expect(parseBearer({ authorization: 'Bearer abc' })).toBe('abc');
    expect(parseBearer({ authorization: 'bearer abc' })).toBe('abc');
  });

  it('is null for a missing, empty or non-bearer header', () => {
    expect(parseBearer({})).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer({ authorization: 'Bearer' })).toBeNull();
    expect(parseBearer({ authorization: 'Basic abc' })).toBeNull();
  });

  it('takes the first value of a repeated header', () => {
    expect(parseBearer({ authorization: ['Bearer a', 'Bearer b'] })).toBe('a');
  });
});

describe('clientIdFromJwtPayload', () => {
  // CLEAN-236. Every Owner and Admin used to be the client `admin`: one
  // conversation per agent for all of them, in which an Admin read what the
  // Owner wrote and a message sent during a turn joined it with the power of
  // whoever started it.
  it('gives the Owner the conversation the administrators shared, and every Admin their own', () => {
    expect(clientIdFromJwtPayload({ sub: 'u1', roles: ['Owner'] })).toEqual({
      clientId: 'admin',
      isAdmin: true,
    });
    expect(clientIdFromJwtPayload({ sub: 'u2', roles: ['Admin'] })).toEqual({
      clientId: 'u2',
      isAdmin: true,
    });
    expect(clientIdFromJwtPayload({ sub: 'u3', roles: ['Admin'] })).toEqual({
      clientId: 'u3',
      isAdmin: true,
    });
  });

  it('an Admin token with no sub proves nobody in particular, and is unusable', () => {
    expect(clientIdFromJwtPayload({ roles: ['Admin'] })).toBeNull();
    expect(clientIdFromJwtPayload({ sub: '', roles: ['Admin'] })).toBeNull();
  });

  it('an Admin never becomes the Owner’s client by naming themselves so', () => {
    expect(
      clientIdFromJwtPayload({ sub: 'admin', roles: ['Admin'] }),
    ).toBeNull();
  });

  it('uses the sub for everyone else', () => {
    expect(clientIdFromJwtPayload({ sub: 'u1', roles: ['User'] })).toEqual({
      clientId: 'u1',
      isAdmin: false,
    });
  });

  it('admits an admin token that carries no sub', () => {
    expect(clientIdFromJwtPayload({ roles: ['Owner'] })).toEqual({
      clientId: 'admin',
      isAdmin: true,
    });
  });

  it('never reads an agent’s service token as an administrator (CLEAN-232)', () => {
    // The Ranch admin agent's token carries Owner. Its runtime can print it,
    // and `admin` is the conversation every Owner and Admin shares.
    for (const roles of [['Owner'], ['Admin'], ['Owner', 'Admin'], ['Agent']]) {
      expect(
        clientIdFromJwtPayload({ sub: 'agent:agent-ranch', roles }),
      ).toEqual({ clientId: 'agent:agent-ranch', isAdmin: false });
    }
    // Its own client: not the shared one, and not another agent's.
    expect(
      clientIdFromJwtPayload({ sub: 'agent:other', roles: ['Owner'] })
        ?.clientId,
    ).toBe('agent:other');
    // A person whose id merely contains the word is still a person.
    expect(
      clientIdFromJwtPayload({ sub: 'user-agent:1', roles: ['Owner'] }),
    ).toEqual({ clientId: 'admin', isAdmin: true });
  });

  it('is null when the payload proves nothing usable', () => {
    // The bug this replaced handed back `undefined` as a client id, which then
    // travelled onto the request and skipped an ownership check.
    expect(clientIdFromJwtPayload({ roles: ['User'] })).toBeNull();
    expect(clientIdFromJwtPayload({ sub: '' })).toBeNull();
    expect(clientIdFromJwtPayload({ sub: 42 })).toBeNull();
    expect(clientIdFromJwtPayload(null)).toBeNull();
  });
});

describe('hasShareToken', () => {
  it('counts an EMPTY token header as offered', () => {
    // It must reach authorizeChat and come back 403, never slip into the
    // anonymous path.
    expect(hasShareToken({ 'x-share-token': '' })).toBe(true);
  });

  it('counts a real token as offered', () => {
    expect(hasShareToken({ 'x-share-token': 'sl_x' })).toBe(true);
  });

  it('is false when the header is absent, even with a visitor id', () => {
    expect(hasShareToken({})).toBe(false);
    expect(hasShareToken(undefined)).toBe(false);
    expect(hasShareToken({ 'x-share-visitor': 'v1' })).toBe(false);
  });
});

describe('resolveShareIdentity', () => {
  it('passes token, path agent id and visitor straight to the authorizer', async () => {
    const calls: Array<[string, string, string]> = [];
    const authorizer = {
      authorizeChat: async (t: string, a: string, v: string) => {
        calls.push([t, a, v]);
        return `share-${v}`;
      },
    };

    await expect(
      resolveShareIdentity(
        { 'x-share-token': 'sl_x', 'x-share-visitor': 'v1' },
        'agent-1',
        authorizer,
      ),
    ).resolves.toBe('share-v1');
    expect(calls).toEqual([['sl_x', 'agent-1', 'v1']]);
  });

  it('sends empty strings rather than skipping the check', async () => {
    const calls: Array<[string, string, string]> = [];
    const authorizer = {
      authorizeChat: async (t: string, a: string, v: string) => {
        calls.push([t, a, v]);
        return 'unused';
      },
    };

    await resolveShareIdentity({}, 'agent-1', authorizer);
    expect(calls).toEqual([['', 'agent-1', '']]);
  });
});

describe('headerValue', () => {
  it('unwraps a repeated header and passes everything else through', () => {
    expect(headerValue(['a', 'b'])).toBe('a');
    expect(headerValue('a')).toBe('a');
    expect(headerValue(undefined)).toBeUndefined();
  });
});

describe('clientIdFromJwtPayload — embed tokens (CLEAN-175)', () => {
  // An embed token is whatever the holder of an API key asked it to be. One
  // minted with an administrator's role used to be the client `admin`, which
  // is the Owner's own conversation now (CLEAN-236): it is its `sub`, and
  // still an administrator to the agent.
  it('maps an admin embed token to its sub, never to the Owner’s conversation', () => {
    for (const role of ['Owner', 'Admin']) {
      expect(
        clientIdFromJwtPayload({ sub: 'kiosk', roles: [role], typ: 'embed' }),
      ).toEqual({ clientId: 'kiosk', isAdmin: true });
    }
  });

  it('maps a visitor embed token to its sub', () => {
    expect(
      clientIdFromJwtPayload({ sub: 'wslid-A1', roles: [], typ: 'embed' }),
    ).toEqual({ clientId: 'wslid-A1', isAdmin: false });
  });
});

// CLEAN-232. A client id is the sender the agent runtime sees. `cron` and
// `heartbeat` are the names the runtime gives its own turns, and a hub client
// called that was the agent itself until the runtime stopped reading trust
// off the name. This is the second lock: the hub does not hand those names
// out, whatever a token says.
describe('reserved client ids (CLEAN-232)', () => {
  const RESERVED = [
    'admin',
    'cron',
    'heartbeat',
    'agent:agent-1',
    'agent:',
    'peer:agent-b:ctx-1',
    'peer:',
    // Case and outer spaces aside.
    'Cron',
    'HEARTBEAT',
    ' cron ',
    'Agent:agent-1',
    'PEER:x',
  ];

  it.each(RESERVED)('%p is reserved', (id) => {
    expect(isReservedClientId(id)).toBe(true);
  });

  it.each([
    'wslid-A1234567',
    'user_42',
    // Reserved only as a whole word or as a namespace.
    'cronjob',
    'heartbeats',
    'administrator',
    'my-cron',
    'agent-1',
    'peer-1',
    'user-agent:1',
  ])('%p is an ordinary id', (id) => {
    expect(isReservedClientId(id)).toBe(false);
  });

  it('never is a namespace the hub mints itself', () => {
    // anon-<id> (public embed), share-<visitor> (share link), http-/sync-<uuid>
    // (token-less HTTP): a visitor chooses only what follows the prefix.
    for (const tail of ['cron', 'heartbeat', 'admin', 'x']) {
      for (const prefix of ['anon-', 'share-', 'http-', 'sync-']) {
        expect(isReservedClientId(`${prefix}${tail}`)).toBe(false);
      }
    }
  });

  it('an embed token named after the runtime’s own turns proves nothing', () => {
    for (const sub of ['cron', 'heartbeat', 'Cron', 'peer:agent-b:ctx-1']) {
      expect(
        clientIdFromJwtPayload({ sub, roles: [], typ: 'embed' }),
      ).toBeNull();
      expect(
        clientIdFromJwtPayload({ sub, roles: ['User'], typ: 'embed' }),
      ).toBeNull();
    }
  });

  it('nor does any other token that is not an admin’s', () => {
    for (const sub of ['cron', 'heartbeat', 'admin', 'peer:agent-b:ctx-1']) {
      expect(clientIdFromJwtPayload({ sub, roles: ['User'] })).toBeNull();
      expect(clientIdFromJwtPayload({ sub, roles: [] })).toBeNull();
      expect(clientIdFromJwtPayload({ sub })).toBeNull();
    }
  });

  it('agent:<id> is an agent’s own service token only, never an embed token’s', () => {
    expect(
      clientIdFromJwtPayload({ sub: 'agent:agent-1', roles: ['Agent'] }),
    ).toEqual({ clientId: 'agent:agent-1', isAdmin: false });
    for (const roles of [[], ['User'], ['Agent'], ['Owner']]) {
      expect(
        clientIdFromJwtPayload({ sub: 'agent:agent-1', roles, typ: 'embed' }),
      ).toBeNull();
    }
  });

  it('an admin is still `admin`, whatever the sub says', () => {
    expect(clientIdFromJwtPayload({ sub: 'cron', roles: ['Owner'] })).toEqual({
      clientId: 'admin',
      isAdmin: true,
    });
  });
});
