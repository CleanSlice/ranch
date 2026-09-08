import {
  clientIdFromJwtPayload,
  hasShareToken,
  headerValue,
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
  it('collapses owners and admins onto the shared admin identity', () => {
    expect(clientIdFromJwtPayload({ sub: 'u1', roles: ['Owner'] })).toEqual({
      clientId: 'admin',
      isAdmin: true,
    });
    expect(clientIdFromJwtPayload({ sub: 'u1', roles: ['Admin'] })).toEqual({
      clientId: 'admin',
      isAdmin: true,
    });
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
