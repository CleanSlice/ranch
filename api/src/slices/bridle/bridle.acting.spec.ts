import type { Socket } from 'socket.io';
import { UserRoleTypes } from '#/user/user/domain';
import {
  agentBearer,
  makeActingParty,
} from '#/user/auth/domain/__fixtures__/actingParty';
import { BridleController } from './bridle.controller';
import { BridleGateway } from './data';
import {
  BridleAttachmentService,
  BridleSyncService,
  ConsoleReachService,
  consoleSessionOf,
} from './domain';
import { openAccess } from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { BridleClientWsHandler } from './handlers';

/**
 * The hub mints the acting token (CLEAN-232, T014).
 *
 * A message from a signed-in console person reaches the agent runtime with
 * `acting: { token, role, surface? }`. The runtime carries the token to each
 * Ranch tool call of the turn, and the API turns it back into that person.
 * Everyone else (an embed visitor, a share visitor, an anonymous widget, an
 * agent's own token) gets no `acting` field, so their turn is a guest's.
 *
 * Real pieces throughout: the real hub, the real socket handler and
 * controller, a real `JwtService`, and the real `ActingPartyService` on both
 * ends, so "verifiable" means the token the hub sent out is the one
 * `resolve` accepts.
 */

const AGENT = 'agent-1';

type Outbound = Record<string, unknown> & {
  clientId: string;
  text: string;
  acting?: {
    token: string;
    role: string;
    surface?: string;
    assistant?: { level: string };
  };
  user?: { id: string; email?: string };
};

function makeHub(assistant?: {
  actingLevelFor: (
    agentId: string,
    person: { userId: string; role: string },
  ) => Promise<string | null>;
}) {
  const acting = makeActingParty();
  const hub = new BridleGateway();
  const toAgent: Outbound[] = [];
  hub.registerAgent(AGENT, 'agent-socket', (data: unknown) => {
    const event = data as Outbound;
    if (event.type !== 'message') return;
    toAgent.push(event);
    // Answer at once, so the synchronous route has something to return.
    hub.handleAgentEvent(AGENT, {
      type: 'message',
      clientId: event.clientId,
      text: 'pong',
      messageId: `reply-${toAgent.length}`,
    } as never);
  });

  const attachments = {
    expand: (_agentId: string, text: string) =>
      Promise.resolve({ text, parts: [], attachments: [] }),
  } as unknown as BridleAttachmentService;
  const shareLinks = {
    authorizeChat: (token: string, _agentId: string, visitorId: string) =>
      token === 'sl_live'
        ? Promise.resolve(`share-${visitorId}`)
        : Promise.reject(new Error('dead link')),
  };
  const agentGateway = {
    findById: () =>
      Promise.resolve({
        id: AGENT,
        isPublic: true,
        allowedOrigins: ['https://embed.test'],
      }),
  };

  // The real reach rule over access lists that hide nothing (CLEAN-231): a
  // console person here reaches the agent, so what is tested stays the token.
  const reach = new ConsoleReachService(openAccess(), agentGateway as never);

  const handler = new BridleClientWsHandler(
    hub,
    attachments,
    acting.jwt,
    agentGateway as never,
    shareLinks as never,
    acting.service,
    reach,
    assistant as never,
  );
  const controller = new BridleController(
    hub,
    acting.jwt,
    {} as never,
    {} as never,
    attachments,
    shareLinks as never,
    new BridleSyncService(hub),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    acting.service,
    reach,
    assistant as never,
  );

  let sockets = 0;
  /** Connect a browser socket with this handshake and return it. */
  const connect = async (
    auth: Record<string, unknown>,
    origin?: string,
  ): Promise<Socket & { rejected: string[] }> => {
    const rejected: string[] = [];
    const client = {
      id: `socket-${++sockets}`,
      data: {},
      handshake: {
        auth: { agentId: AGENT, ...auth },
        headers: origin ? { origin } : {},
      },
      emit: (event: string, payload: { code?: string }) => {
        if (event === 'bridle_error') rejected.push(payload.code ?? '');
        return true;
      },
      disconnect: () => undefined,
      rejected,
    } as unknown as Socket & { rejected: string[] };
    await handler.handleConnection(client);
    return client;
  };

  /** A console access token, as `AuthService.sign` makes them. */
  const consoleToken = (userId: string, role: UserRoleTypes) => {
    const { sid } = acting.signIn(userId, role);
    return acting.jwt.sign({
      sub: userId,
      email: `${userId}@example.test`,
      roles: [role],
      sid,
    });
  };

  const say = (client: Socket, text: string) =>
    handler.handleMessage(client, { text });
  const last = () => toAgent[toAgent.length - 1];
  /** Who the API says a tool call carrying this token is for. */
  const resolve = (token: string | undefined, agentId = AGENT) =>
    acting.service.resolve(agentBearer(agentId, true), {
      kind: 'person',
      token,
    });

  return {
    acting,
    hub,
    handler,
    controller,
    toAgent,
    connect,
    consoleToken,
    say,
    last,
    resolve,
  };
}

const res = { setHeader: () => undefined } as never;
const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});

describe('the hub mints an acting token: a console person on the socket', () => {
  it('carries a token the API resolves to that person, for that agent', async () => {
    const h = makeHub();
    const client = await h.connect({
      token: h.consoleToken('user-1', UserRoleTypes.User),
      surface: 'app',
    });

    await h.say(client, 'delete agent X');

    const message = h.last();
    expect(message.text).toBe('delete agent X');
    expect(message.user).toEqual({
      id: 'user-1',
      email: 'user-1@example.test',
    });
    expect(message.acting).toEqual({
      token: expect.any(String) as string,
      role: 'User',
      surface: 'app',
    });
    expect(await h.resolve(message.acting?.token)).toEqual({
      kind: 'person',
      userId: 'user-1',
      role: UserRoleTypes.User,
    });
  });

  it('is worth nothing at another agent', async () => {
    const h = makeHub();
    const client = await h.connect({
      token: h.consoleToken('user-o', UserRoleTypes.Owner),
    });
    await h.say(client, 'hello');

    expect(await h.resolve(h.last().acting?.token, 'agent-2')).toEqual({
      kind: 'guest',
    });
  });

  it('stops working when the person signs out, mid-turn', async () => {
    const h = makeHub();
    const client = await h.connect({
      token: h.consoleToken('user-o', UserRoleTypes.Owner),
    });
    await h.say(client, 'hello');
    const token = h.last().acting?.token;
    expect((await h.resolve(token)).kind).toBe('person');

    h.acting.sessions.get('sid-user-o')!.revokedAt = new Date();

    expect(await h.resolve(token)).toEqual({ kind: 'guest' });
  });

  it('mints per message, and every one of them verifies', async () => {
    const h = makeHub();
    const client = await h.connect({
      token: h.consoleToken('user-a', UserRoleTypes.Admin),
      surface: 'admin',
    });

    await h.say(client, 'one');
    await h.say(client, 'two');

    expect(h.toAgent).toHaveLength(2);
    for (const message of h.toAgent) {
      expect(message.acting?.role).toBe('Admin');
      expect(message.acting?.surface).toBe('admin');
      expect(await h.resolve(message.acting?.token)).toEqual({
        kind: 'person',
        userId: 'user-a',
        role: UserRoleTypes.Admin,
      });
    }
  });

  it('names the sender, not the conversation: two admins on the shared channel', async () => {
    const h = makeHub();
    const owner = await h.connect({
      token: h.consoleToken('user-o', UserRoleTypes.Owner),
    });
    const admin = await h.connect({
      token: h.consoleToken('user-a', UserRoleTypes.Admin),
    });

    await h.say(admin, 'from the admin');
    await h.say(owner, 'from the owner');

    const [fromAdmin, fromOwner] = h.toAgent;
    // One conversation, as before CLEAN-232 …
    expect(fromAdmin.clientId).toBe('admin');
    expect(fromOwner.clientId).toBe('admin');
    // … and two people.
    expect(await h.resolve(fromAdmin.acting?.token)).toMatchObject({
      userId: 'user-a',
      role: UserRoleTypes.Admin,
    });
    expect(await h.resolve(fromOwner.acting?.token)).toMatchObject({
      userId: 'user-o',
      role: UserRoleTypes.Owner,
    });
  });

  it('takes the surface only when it is exactly app or admin', async () => {
    const h = makeHub();
    const token = h.consoleToken('user-1', UserRoleTypes.User);

    for (const surface of [
      'root',
      'ADMIN',
      '',
      7,
      { is: 'admin' },
      undefined,
    ]) {
      const client = await h.connect({ token, surface });
      await h.say(client, 'hi');
      expect(h.last().acting?.token).toEqual(expect.any(String));
      expect(h.last().acting).not.toHaveProperty('surface');
    }
  });

  it('the role beside the token is for display: the API reads its own', async () => {
    const h = makeHub();
    const client = await h.connect({
      token: h.consoleToken('user-a', UserRoleTypes.Admin),
    });
    // Demoted after signing in; the console token on the socket is stale.
    h.acting.users.get('user-a')!.role = UserRoleTypes.User;

    await h.say(client, 'hi');

    expect(h.last().acting?.role).toBe('Admin');
    expect(await h.resolve(h.last().acting?.token)).toMatchObject({
      role: UserRoleTypes.User,
    });
  });
});

// CLEAN-240: when the agent is the assistant, the hub also says which level
// the person uses it at. Wording for the turn's prompt and nothing more: the
// token beside it is still the only thing that grants.
describe('the hub says the person’s assistant level', () => {
  const levels = (answer: string | null) => ({
    actingLevelFor: jest.fn(async () => answer),
  });

  it('on the socket, beside the token', async () => {
    const assistant = levels('standard');
    const h = makeHub(assistant);
    const client = await h.connect({
      token: h.consoleToken('user-a', UserRoleTypes.Admin),
      surface: 'admin',
    });
    await h.say(client, 'what can you do for me?');

    expect(h.last().acting).toEqual({
      token: expect.any(String) as string,
      role: 'Admin',
      surface: 'admin',
      assistant: { level: 'standard' },
    });
    expect(assistant.actingLevelFor).toHaveBeenCalledWith(AGENT, {
      userId: 'user-a',
      role: UserRoleTypes.Admin,
    });
  });

  it('on the HTTP routes', async () => {
    const h = makeHub(levels('owner'));
    await h.controller.sendMessage(
      AGENT,
      bearer(h.consoleToken('user-o', UserRoleTypes.Owner)),
      { text: 'who is on which level?' } as never,
      res,
    );
    expect(h.last().acting?.assistant).toEqual({ level: 'owner' });
  });

  it('nothing for an agent that is not the assistant', async () => {
    const h = makeHub(levels(null));
    const client = await h.connect({
      token: h.consoleToken('user-1', UserRoleTypes.User),
    });
    await h.say(client, 'hello');
    expect(h.last().acting).not.toHaveProperty('assistant');
  });

  it('nothing for a visitor: there is no person to have a level', async () => {
    const assistant = levels('basic');
    const h = makeHub(assistant);
    const client = await h.connect({
      shareToken: 'sl_live',
      shareVisitor: 'v1',
    });
    await h.say(client, 'hello');
    expect(h.last().acting).toBeUndefined();
    expect(assistant.actingLevelFor).not.toHaveBeenCalled();
  });

  it('a level that cannot be read costs the wording, never the token', async () => {
    const h = makeHub({
      actingLevelFor: jest.fn(async () => {
        throw new Error('db down');
      }),
    });
    const client = await h.connect({
      token: h.consoleToken('user-a', UserRoleTypes.Admin),
    });
    await h.say(client, 'restart agent X');
    expect(h.last().acting?.token).toEqual(expect.any(String));
    expect(h.last().acting).not.toHaveProperty('assistant');
  });

  it('a hub built without it says nothing, as before', async () => {
    const h = makeHub();
    const client = await h.connect({
      token: h.consoleToken('user-a', UserRoleTypes.Admin),
    });
    await h.say(client, 'hello');
    expect(h.last().acting).not.toHaveProperty('assistant');
  });
});

describe('the hub mints no acting token for anyone else', () => {
  it('an embed visitor, whatever roles the embed token carries', async () => {
    const h = makeHub();
    for (const roles of [[], [UserRoleTypes.User], [UserRoleTypes.Owner]]) {
      const embed = h.acting.jwt.sign({
        sub: 'wslid-A1234567',
        email: '',
        roles,
        typ: 'embed',
        // Not something `mintEmbedToken` writes; a session id must not be
        // enough to turn an embed token into a console one.
        sid: 'sid-user-o',
      });
      const client = await h.connect({ token: embed, surface: 'admin' });
      await h.say(client, 'delete agent X');

      expect(h.last().text).toBe('delete agent X');
      expect(h.last()).not.toHaveProperty('acting');
    }
  });

  it('a share visitor', async () => {
    const h = makeHub();
    const client = await h.connect({
      shareToken: 'sl_live',
      shareVisitor: 'v-123',
      surface: 'app',
    });
    await h.say(client, 'hi');

    expect(h.last().clientId).toBe('share-v-123');
    expect(h.last()).not.toHaveProperty('acting');
  });

  it('an anonymous widget on a public agent', async () => {
    const h = makeHub();
    const client = await h.connect({ surface: 'app' }, 'https://embed.test');
    await h.say(client, 'hi');

    expect(h.last().clientId).toMatch(/^anon-/);
    expect(h.last()).not.toHaveProperty('acting');
  });

  it('an agent’s own service token, though it carries Owner', async () => {
    const h = makeHub();
    const service = h.acting.jwt.sign(agentBearer('agent-9', true));
    const client = await h.connect({ token: service, surface: 'admin' });
    await h.say(client, 'hi');

    expect(h.last()).not.toHaveProperty('acting');
  });

  it('a console token without a session id', async () => {
    const h = makeHub();
    const noSid = h.acting.jwt.sign({
      sub: 'user-o',
      email: 'o@example.test',
      roles: [UserRoleTypes.Owner],
    });
    const client = await h.connect({ token: noSid });
    await h.say(client, 'hi');

    expect(h.last()).not.toHaveProperty('acting');
  });

  it('refuses an acting token at the handshake: it is not a chat credential', async () => {
    const h = makeHub();
    const { userId, sid } = h.acting.signIn('user-o', UserRoleTypes.Owner);
    const token = await h.acting.service.mint({ userId, agentId: AGENT, sid });

    // On a private agent it is an invalid token …
    const hub = makeHub();
    const priv = new BridleClientWsHandler(
      hub.hub,
      {} as BridleAttachmentService,
      hub.acting.jwt,
      {
        findById: () => Promise.resolve({ id: AGENT, isPublic: false }),
      } as never,
      {} as never,
      hub.acting.service,
      // Never asked: an acting token is refused before the access lists.
      {} as never,
    );
    const rejected: string[] = [];
    await priv.handleConnection({
      id: 's',
      data: {},
      handshake: { auth: { agentId: AGENT, token }, headers: {} },
      emit: (event: string, payload: { code?: string }) => {
        if (event === 'bridle_error') rejected.push(payload.code ?? '');
        return true;
      },
      disconnect: () => undefined,
    } as unknown as Socket);
    expect(rejected).toEqual(['INVALID_TOKEN']);

    // … and on a public one it degrades to the anonymous visitor, like any
    // other bad token: never the person it names.
    const client = await h.connect({ token }, 'https://embed.test');
    await h.say(client, 'hi');
    expect(h.last().clientId).toMatch(/^anon-/);
    expect(h.last()).not.toHaveProperty('acting');
    expect(h.last()).not.toHaveProperty('user');
  });
});

describe('the hub mints an acting token: the HTTP message routes', () => {
  it('fire-and-forget: a console person gets one, verifiable for that agent', async () => {
    const h = makeHub();

    await h.controller.sendMessage(
      AGENT,
      bearer(h.consoleToken('user-a', UserRoleTypes.Admin)),
      { text: 'restart agent X' } as never,
      res,
    );

    const message = h.last();
    expect(message.text).toBe('restart agent X');
    expect(message.acting?.role).toBe('Admin');
    // The HTTP routes have no handshake to declare a console in.
    expect(message.acting).not.toHaveProperty('surface');
    expect(await h.resolve(message.acting?.token)).toEqual({
      kind: 'person',
      userId: 'user-a',
      role: UserRoleTypes.Admin,
    });
    expect(await h.resolve(message.acting?.token, 'agent-2')).toEqual({
      kind: 'guest',
    });
  });

  it('synchronous: the same, through the wait', async () => {
    const h = makeHub();

    const reply = await h.controller.sendMessageSync(
      AGENT,
      bearer(h.consoleToken('user-1', UserRoleTypes.User)),
      { text: 'delete agent X' } as never,
      res,
    );

    expect((reply as { text: string }).text).toBe('pong');
    expect(h.last().acting?.role).toBe('User');
    expect(await h.resolve(h.last().acting?.token)).toEqual({
      kind: 'person',
      userId: 'user-1',
      role: UserRoleTypes.User,
    });
  });

  it('names the requester as the user, not whoever else has the shared channel open', async () => {
    const h = makeHub();
    // The Owner has the shared `admin` conversation open on a socket …
    await h.connect({ token: h.consoleToken('user-o', UserRoleTypes.Owner) });
    // … and an Admin sends into the same conversation over HTTP. The hub
    // used to take `user` from the first socket on the channel, so the
    // message said "from the Owner" beside the Admin's acting token.
    const asAdmin = bearer(h.consoleToken('user-a', UserRoleTypes.Admin));

    await h.controller.sendMessage(
      AGENT,
      asAdmin,
      { text: 'one' } as never,
      res,
    );

    const first = h.last();
    expect(first.clientId).toBe('admin');
    expect(first.user).toEqual({ id: 'user-a', email: 'user-a@example.test' });
    expect(await h.resolve(first.acting?.token)).toMatchObject({
      userId: 'user-a',
      role: UserRoleTypes.Admin,
    });

    await h.controller.sendMessageSync(
      AGENT,
      asAdmin,
      { text: 'two' } as never,
      res,
    );

    const second = h.last();
    expect(second.text).toBe('two');
    expect(second.user).toEqual({ id: 'user-a', email: 'user-a@example.test' });
    expect(await h.resolve(second.acting?.token)).toMatchObject({
      userId: 'user-a',
    });
  });

  it('a sender stated as nobody carries no user, whoever shares the channel', async () => {
    const h = makeHub();
    await h.connect({ token: h.consoleToken('user-o', UserRoleTypes.Owner) });

    // What the HTTP routes pass for a requester with no login behind it.
    h.hub.sendToAgent('admin', AGENT, 'x', [], undefined, { user: null });
    expect(h.last()).not.toHaveProperty('user');

    // Unstated, the socket still speaks for itself, as a websocket message
    // always has.
    h.hub.sendToAgent('admin', AGENT, 'y', []);
    expect(h.last().user).toEqual({
      id: 'user-o',
      email: 'user-o@example.test',
    });
  });

  it('none for an embed token, a share visitor or an anonymous caller', async () => {
    const h = makeHub();
    const embed = h.acting.jwt.sign({
      sub: 'wslid-A1234567',
      email: '',
      roles: [UserRoleTypes.Owner],
      typ: 'embed',
    });
    const callers: Array<Record<string, unknown>> = [
      bearer(embed),
      { headers: { 'x-share-token': 'sl_live', 'x-share-visitor': 'v-123' } },
      { headers: {} },
    ];

    for (const req of callers) {
      await h.controller.sendMessage(AGENT, req, { text: 'a' } as never, res);
      expect(h.last()).not.toHaveProperty('acting');
      await h.controller.sendMessageSync(
        AGENT,
        req,
        { text: 'b' } as never,
        res,
      );
      expect(h.last()).not.toHaveProperty('acting');
    }
    expect(h.toAgent).toHaveLength(6);
  });

  it('refuses an acting token as the bearer of a message', async () => {
    const h = makeHub();
    const { userId, sid } = h.acting.signIn('user-o', UserRoleTypes.Owner);
    const token = await h.acting.service.mint({ userId, agentId: AGENT, sid });

    await expect(
      h.controller.sendMessage(
        AGENT,
        bearer(token),
        { text: 'a' } as never,
        res,
      ),
    ).rejects.toMatchObject({ response: { code: 'TOKEN_INVALID' } });
    expect(h.toAgent).toHaveLength(0);
  });
});

describe('when the token cannot be minted', () => {
  it('the message still reaches the agent, as a guest’s: no acting field', async () => {
    const h = makeHub();
    const client = await h.connect({
      token: h.consoleToken('user-o', UserRoleTypes.Owner),
    });
    const token = h.consoleToken('user-a', UserRoleTypes.Admin);
    jest
      .spyOn(h.acting.service, 'mint')
      .mockRejectedValue(new Error('signing key unavailable'));

    await h.say(client, 'over the socket');
    expect(h.last().text).toBe('over the socket');
    expect(h.last()).not.toHaveProperty('acting');

    await h.controller.sendMessage(
      AGENT,
      bearer(token),
      { text: 'over http' } as never,
      res,
    );
    expect(h.last().text).toBe('over http');
    expect(h.last()).not.toHaveProperty('acting');
  });
});

describe('the hub itself never invents an acting token', () => {
  it('forwards what the caller minted, and nothing for a caller that minted none', () => {
    const hub = new BridleGateway();
    const toAgent: Outbound[] = [];
    hub.registerAgent(AGENT, 'agent-socket', (d: unknown) =>
      toAgent.push(d as Outbound),
    );
    // A console login is registered on the socket, as CLEAN-80 does …
    hub.registerClient(
      'admin',
      AGENT,
      'tab-a',
      () => undefined,
      true,
      undefined,
      undefined,
      {
        id: 'user-o',
      },
    );

    hub.sendToAgent('admin', AGENT, 'no token', [], undefined, {
      socketId: 'tab-a',
    });
    hub.sendToAgent('admin', AGENT, 'with token', [], undefined, {
      socketId: 'tab-a',
      acting: {
        token: 'minted-by-the-caller',
        role: 'Owner',
        surface: 'admin',
      },
    });
    hub.sendToAgent('admin', AGENT, 'empty token', [], undefined, {
      socketId: 'tab-a',
      acting: { token: '', role: 'Owner' },
    });

    // … and the identity alone is not proof: no token in, no `acting` out.
    expect(toAgent[0].user).toEqual({ id: 'user-o' });
    expect(toAgent[0]).not.toHaveProperty('acting');
    expect(toAgent[1].acting).toEqual({
      token: 'minted-by-the-caller',
      role: 'Owner',
      surface: 'admin',
    });
    expect(toAgent[2]).not.toHaveProperty('acting');
  });
});

describe('consoleSessionOf: which token is a person’s own', () => {
  const base = {
    sub: 'user-1',
    email: 'u@example.test',
    roles: ['User'],
    sid: 'sid-1',
  };

  it('a console token: the person, the session and the strongest role', () => {
    expect(consoleSessionOf(base)).toEqual({
      userId: 'user-1',
      sid: 'sid-1',
      role: 'User',
    });
    expect(
      consoleSessionOf({ ...base, roles: ['User', 'Owner', 'Admin'] })?.role,
    ).toBe('Owner');
  });

  it.each([
    ['an embed token', { ...base, typ: 'embed' }],
    ['an acting token', { ...base, typ: 'acting' }],
    ['any other typ', { ...base, typ: 'something' }],
    ['an agent service token', { ...base, sub: 'agent:a1', roles: ['Owner'] }],
    ['a token with no session id', { ...base, sid: undefined }],
    ['a token with an empty session id', { ...base, sid: '' }],
    ['a token with no subject', { ...base, sub: undefined }],
    ['a token with no person role', { ...base, roles: [] }],
    ['a token with the Agent role only', { ...base, roles: ['Agent'] }],
    ['a token whose roles are not a list', { ...base, roles: 'Owner' }],
  ])('not %s', (_label, payload) => {
    expect(consoleSessionOf(payload as never)).toBeNull();
  });

  it('nothing at all', () => {
    expect(consoleSessionOf(null)).toBeNull();
    expect(consoleSessionOf(undefined)).toBeNull();
  });
});
