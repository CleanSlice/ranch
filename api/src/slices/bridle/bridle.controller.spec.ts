import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ShareLinkService } from '#/agent/shareLink/domain';
import { BridleController } from './bridle.controller';
import { BridleAttachmentService } from './domain';
import type { IBridleAttachment, BridlePart } from './domain';

/**
 * Chat identity on the HTTP path. Everything here is about WHO the hub is told
 * is talking: a share visitor must arrive as `share-<visitorId>` so the agent
 * runtime keys approval and history on one stable channel, and a token that no
 * longer works must fail loudly instead of being demoted to an anonymous
 * throwaway id — a silent demotion would look like a working chat that has
 * quietly lost its history.
 */

interface IRegistered {
  clientId: string;
  agentId: string;
  socketId: string;
}

interface IStubs {
  verify?: (token: string) => Record<string, unknown>;
  authorizeChat?: (
    token: string,
    agentId: string,
    visitorId: string,
  ) => Promise<string>;
}

function makeController(stubs: IStubs = {}) {
  const registered: IRegistered[] = [];
  const sent: Array<{ clientId: string; agentId: string; text: string }> = [];

  const hub = {
    registerClient: (
      clientId: string,
      agentId: string,
      socketId: string,
      onEvent: (data: unknown) => void,
    ) => {
      registered.push({ clientId, agentId, socketId });
      // Answer immediately so `message/sync` resolves without its 120 s wait.
      setImmediate(() =>
        onEvent({ type: 'message', text: 'pong', messageId: 'm1', ts: 1 }),
      );
    },
    unregisterClient: jest.fn(),
    sendToAgent: (
      clientId: string,
      agentId: string,
      text: string,
      _parts: BridlePart[],
      _attachments?: IBridleAttachment[],
    ) => {
      sent.push({ clientId, agentId, text });
    },
  };

  const jwt = {
    verify:
      stubs.verify ??
      (() => {
        throw new Error('invalid token');
      }),
  } as unknown as JwtService;

  const shareCalls: Array<[string, string, string]> = [];
  const shareLinks = {
    authorizeChat: async (
      token: string,
      agentId: string,
      visitorId: string,
    ) => {
      shareCalls.push([token, agentId, visitorId]);
      if (stubs.authorizeChat) {
        return stubs.authorizeChat(token, agentId, visitorId);
      }
      return `share-${visitorId}`;
    },
  } as unknown as ShareLinkService;

  const attachments = {
    expand: async (_agentId: string, text: string) => ({
      text,
      parts: [],
      attachments: [],
    }),
  } as unknown as BridleAttachmentService;

  const controller = new BridleController(
    hub as never,
    jwt,
    {} as never,
    {} as never,
    attachments,
    shareLinks,
  );

  return { controller, hub, registered, sent, shareCalls };
}

function request(headers: Record<string, string>): Record<string, unknown> {
  return { headers };
}

const AGENT = 'agent-1';
const SHARE_HEADERS = {
  'x-share-token': 'sl_live',
  'x-share-visitor': 'visitor-7',
};

describe('BridleController — share visitors on message/sync', () => {
  it('registers the visitor on the hub under their share client id', async () => {
    const { controller, registered, sent, shareCalls } = makeController();

    await controller.sendMessageSync(AGENT, request(SHARE_HEADERS), {
      text: 'hello',
    } as never);

    expect(registered).toHaveLength(1);
    expect(registered[0].clientId).toBe('share-visitor-7');
    expect(sent[0].clientId).toBe('share-visitor-7');
    // Validated against the agent in the path, on this very request.
    expect(shareCalls).toEqual([['sl_live', AGENT, 'visitor-7']]);
  });

  it('uses the same identity on the fire-and-forget route', async () => {
    const { controller, sent } = makeController();

    await controller.sendMessage(AGENT, request(SHARE_HEADERS), {
      text: 'hello',
    } as never);

    expect(sent[0].clientId).toBe('share-visitor-7');
  });
});

describe('BridleController — rejected share tokens', () => {
  it('answers 403 SHARE_LINK_INVALID for a revoked token and never reaches the hub', async () => {
    const { controller, registered } = makeController({
      authorizeChat: () =>
        Promise.reject(new ForbiddenException({ code: 'SHARE_LINK_INVALID' })),
    });

    await expect(
      controller.sendMessageSync(
        AGENT,
        request({ ...SHARE_HEADERS, 'x-share-token': 'sl_dead' }),
        { text: 'hello' } as never,
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHARE_LINK_INVALID' },
    });

    expect(registered).toHaveLength(0);
  });

  it('rejects a token minted for another agent', async () => {
    // The service compares the link's agentId with the path param; the
    // controller must hand it the path param and nothing else.
    const { controller, registered, shareCalls } = makeController({
      authorizeChat: (_t, agentId) =>
        agentId === 'agent-2'
          ? Promise.resolve('share-visitor-7')
          : Promise.reject(
              new ForbiddenException({ code: 'SHARE_LINK_INVALID' }),
            ),
    });

    await expect(
      controller.sendMessageSync(AGENT, request(SHARE_HEADERS), {
        text: 'hello',
      } as never),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHARE_LINK_INVALID' },
    });
    expect(shareCalls[0][1]).toBe(AGENT);
    expect(registered).toHaveLength(0);
  });

  it('never falls back to an anonymous id when the token is present but bad', async () => {
    // The whole point of the 403: a demotion to `sync-<uuid>` would look like
    // a working chat that silently lost its history.
    const { controller, sent } = makeController({
      authorizeChat: () =>
        Promise.reject(
          new ForbiddenException({ code: 'SHARE_VISITOR_INVALID' }),
        ),
    });

    await expect(
      controller.sendMessage(
        AGENT,
        request({ 'x-share-token': 'sl_live', 'x-share-visitor': 'not ok!' }),
        { text: 'hello' } as never,
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHARE_VISITOR_INVALID' },
    });
    expect(sent).toHaveLength(0);
  });
});

describe('BridleController — identity precedence', () => {
  it('lets a valid JWT win over share headers that ride along', async () => {
    const { controller, registered, shareCalls } = makeController({
      verify: () => ({ sub: 'user-1', roles: ['User'] }),
    });

    await controller.sendMessageSync(
      AGENT,
      request({ authorization: 'Bearer jwt-token', ...SHARE_HEADERS }),
      { text: 'hello' } as never,
    );

    expect(registered[0].clientId).toBe('user-1');
    expect(shareCalls).toHaveLength(0);
  });

  it('still maps console admins to the shared admin identity', async () => {
    const { controller, registered } = makeController({
      verify: () => ({ sub: 'user-9', roles: ['Admin'] }),
    });

    await controller.sendMessageSync(
      AGENT,
      request({ authorization: 'Bearer jwt-token' }),
      { text: 'hello' } as never,
    );

    expect(registered[0].clientId).toBe('admin');
  });

  it('keeps the anonymous fallback when no headers are offered at all', async () => {
    const { controller, registered, shareCalls } = makeController();

    await controller.sendMessageSync(AGENT, request({}), {
      text: 'hello',
    } as never);

    expect(registered[0].clientId).toMatch(/^sync-[0-9a-f-]{36}$/);
    expect(shareCalls).toHaveLength(0);
  });

  it('keeps the http- fallback on the fire-and-forget route', async () => {
    const { controller, sent } = makeController();

    await controller.sendMessage(AGENT, request({}), {
      text: 'hello',
    } as never);

    expect(sent[0].clientId).toMatch(/^http-[0-9a-f-]{36}$/);
  });

  it('falls back to anonymous for a bad JWT with no share headers, as before', async () => {
    const { controller, registered } = makeController({
      verify: () => {
        throw new Error('jwt expired');
      },
    });

    await controller.sendMessageSync(
      AGENT,
      request({ authorization: 'Bearer stale' }),
      { text: 'hello' } as never,
    );

    expect(registered[0].clientId).toMatch(/^sync-/);
  });
});
