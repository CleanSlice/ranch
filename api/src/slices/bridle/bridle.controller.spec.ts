import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ShareLinkService } from '#/agent/shareLink/domain';
import { BridleController } from './bridle.controller';
import { BridleAttachmentService } from './domain';
import type {
  IAttachmentRequester,
  IBridleAttachment,
  BridlePart,
} from './domain';
import type { IChatAuthRequest } from './guards/bridleChatAuth.guard';

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
    clearAgentSession: jest.fn(),
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

  const expandCalls: IAttachmentRequester[] = [];
  const attachments = {
    expand: async (
      _agentId: string,
      text: string,
      _ids: string[] | undefined,
      requester: IAttachmentRequester,
    ) => {
      expandCalls.push(requester);
      return { text, parts: [], attachments: [] };
    },
    upload: async (input: { owner?: string }) => ({ owner: input.owner }),
    fetchFor: async (
      _agentId: string,
      _id: string,
      requester: IAttachmentRequester,
    ) => {
      fetchCalls.push(requester);
      return null;
    },
  } as unknown as BridleAttachmentService;

  const fetchCalls: IAttachmentRequester[] = [];
  const fileCalls: Array<{ op: string; path: string }> = [];
  const fileGateway = {
    delete: async (_agentId: string, path: string) => {
      fileCalls.push({ op: 'delete', path });
    },
    read: async (_agentId: string, path: string) => {
      fileCalls.push({ op: 'read', path });
      // "Nothing to archive" — the archive route's documented early return.
      throw Object.assign(new Error('not found'), { status: 404 });
    },
  };
  const transcriptReader = {
    read: async (_agentId: string, path: string) => {
      fileCalls.push({ op: 'transcript', path });
      return [];
    },
  };

  const controller = new BridleController(
    hub as never,
    jwt,
    fileGateway as never,
    transcriptReader as never,
    attachments,
    shareLinks,
  );

  return {
    controller,
    hub,
    registered,
    sent,
    shareCalls,
    expandCalls,
    fetchCalls,
    fileCalls,
  };
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

describe('BridleController — requester travels into attachment expansion', () => {
  it('hands the share visitor identity to expand, not just to the hub', async () => {
    // `attachmentIds` is a read; without the requester the expansion path is
    // an unguarded way to inline someone else's file.
    const { controller, expandCalls } = makeController();

    await controller.sendMessageSync(AGENT, request(SHARE_HEADERS), {
      text: 'hello',
      attachmentIds: ['a1'],
    } as never);

    expect(expandCalls).toEqual([
      { clientId: 'share-visitor-7', kind: 'share' },
    ]);
  });

  it('marks a token-less sender anonymous rather than borrowing its throwaway id', async () => {
    const { controller, expandCalls } = makeController();

    await controller.sendMessage(AGENT, request({}), {
      text: 'hello',
      attachmentIds: ['a1'],
    } as never);

    expect(expandCalls).toEqual([{ clientId: null, kind: 'anonymous' }]);
  });

  it('marks a console sender jwt', async () => {
    const { controller, expandCalls } = makeController({
      verify: () => ({ sub: 'user-1', roles: ['User'] }),
    });

    await controller.sendMessage(
      AGENT,
      request({ authorization: 'Bearer jwt-token' }),
      { text: 'hello', attachmentIds: ['a1'] } as never,
    );

    expect(expandCalls).toEqual([{ clientId: 'user-1', kind: 'jwt' }]);
  });

  it('treats a signed token with no subject as anonymous, not as an empty id', async () => {
    const { controller, expandCalls, registered } = makeController({
      verify: () => ({ email: 'nobody@example.com' }),
    });

    await controller.sendMessageSync(
      AGENT,
      request({ authorization: 'Bearer jwt-token' }),
      { text: 'hello', attachmentIds: ['a1'] } as never,
    );

    expect(expandCalls).toEqual([{ clientId: null, kind: 'anonymous' }]);
    expect(registered[0].clientId).toMatch(/^sync-/);
  });

  it('counts an empty share token as offered and refuses the message', async () => {
    const { controller, shareCalls, expandCalls } = makeController({
      authorizeChat: () =>
        Promise.reject(new ForbiddenException({ code: 'SHARE_LINK_INVALID' })),
    });

    await expect(
      controller.sendMessage(AGENT, request({ 'x-share-token': '' }), {
        text: 'hello',
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(shareCalls).toEqual([['', AGENT, '']]);
    expect(expandCalls).toHaveLength(0);
  });
});

describe('BridleController — attachment routes read the guard verdict', () => {
  function guarded(chatAuth?: {
    clientId: string;
    kind: 'jwt' | 'share';
  }): IChatAuthRequest {
    return { chatAuth } as unknown as IChatAuthRequest;
  }

  const file = {
    originalname: 'a.txt',
    mimetype: 'text/plain',
    size: 1,
    buffer: Buffer.from('x'),
  };

  it('stamps the guard-proved identity as the uploaded object owner', async () => {
    const { controller } = makeController();

    const result = await controller.uploadAttachment(
      AGENT,
      guarded({ clientId: 'share-visitor-7', kind: 'share' }),
      file,
    );

    expect(result).toMatchObject({ owner: 'share-visitor-7' });
  });

  it('passes the guard verdict to fetchFor verbatim on download', async () => {
    // The kind must come from the guard, never from the shape of the id.
    const { controller, fetchCalls } = makeController();

    await expect(
      controller.downloadAttachment(
        AGENT,
        'a1',
        guarded({ clientId: 'share-visitor-7', kind: 'share' }),
        {} as never,
      ),
    ).rejects.toMatchObject({ status: 404 });

    expect(fetchCalls).toEqual([
      { clientId: 'share-visitor-7', kind: 'share' },
    ]);
  });

  it('401s rather than reading anything when the guard left no identity', async () => {
    const { controller, fetchCalls } = makeController();

    await expect(
      controller.downloadAttachment(AGENT, 'a1', guarded(), {} as never),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      controller.uploadAttachment(AGENT, guarded(), file),
    ).rejects.toMatchObject({ status: 401 });

    expect(fetchCalls).toHaveLength(0);
  });
});

describe('BridleController — transcripts on a share channel', () => {
  const SHARE_CHANNEL = 'share-visitor-7';

  it('lets a console user read any share channel', async () => {
    const { controller, fileCalls } = makeController({
      verify: () => ({ sub: 'user-1', roles: ['Admin'] }),
    });

    const out = await controller.transcript(
      AGENT,
      request({ authorization: 'Bearer jwt-token' }),
      { channel: SHARE_CHANNEL } as never,
    );

    expect(out.channel).toBe(SHARE_CHANNEL);
    expect(fileCalls[0].path).toContain(`bridle:${SHARE_CHANNEL}.jsonl`);
  });

  it('lets the visitor read their own channel', async () => {
    const { controller, fileCalls } = makeController();

    await controller.transcript(AGENT, request(SHARE_HEADERS), {
      channel: SHARE_CHANNEL,
    } as never);

    expect(fileCalls[0].path).toContain(`bridle:${SHARE_CHANNEL}.jsonl`);
  });

  it('refuses the channel of another visitor with the uniform 403', async () => {
    // Same body whether or not the channel exists — nothing here confirms a
    // conversation is there to be found.
    const { controller, fileCalls } = makeController();

    await expect(
      controller.transcript(AGENT, request(SHARE_HEADERS), {
        channel: 'share-visitor-8',
      } as never),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHARE_LINK_INVALID' },
    });
    expect(fileCalls).toHaveLength(0);
  });

  it('refuses an anonymous reader', async () => {
    const { controller, fileCalls } = makeController();

    await expect(
      controller.transcript(AGENT, request({}), {
        channel: SHARE_CHANNEL,
      } as never),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHARE_LINK_INVALID' },
    });
    expect(fileCalls).toHaveLength(0);
  });

  it('refuses an anonymous DELETE of a share channel', async () => {
    const { controller, fileCalls } = makeController();

    await expect(
      controller.resetTranscript(AGENT, request({}), SHARE_CHANNEL),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHARE_LINK_INVALID' },
    });
    expect(fileCalls).toHaveLength(0);
  });

  it('refuses a DELETE aimed at another visitor and allows the owner', async () => {
    const { controller, fileCalls } = makeController();

    await expect(
      controller.resetTranscript(AGENT, request(SHARE_HEADERS), 'share-other'),
    ).rejects.toMatchObject({ status: 403 });

    await controller.resetTranscript(
      AGENT,
      request(SHARE_HEADERS),
      SHARE_CHANNEL,
    );
    expect(fileCalls).toEqual([
      { op: 'delete', path: `data/sessions/bridle:${SHARE_CHANNEL}.jsonl` },
    ]);
  });

  it('refuses an anonymous archive of a share channel and allows the owner', async () => {
    const { controller, fileCalls } = makeController();

    await expect(
      controller.archiveTranscript(AGENT, request({}), SHARE_CHANNEL),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      controller.archiveTranscript(
        AGENT,
        request(SHARE_HEADERS),
        SHARE_CHANNEL,
      ),
    ).resolves.toEqual({});
    expect(fileCalls).toEqual([
      { op: 'read', path: `data/sessions/bridle:${SHARE_CHANNEL}.jsonl` },
    ]);
  });

  it('leaves non-share channels exactly as unauthenticated as they were', async () => {
    const { controller, fileCalls, shareCalls } = makeController();

    await controller.transcript(AGENT, request({}), {
      channel: 'admin',
    } as never);

    expect(fileCalls[0].path).toContain('bridle:admin.jsonl');
    expect(shareCalls).toHaveLength(0);
  });
});
