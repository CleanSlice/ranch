import { BadRequestException } from '@nestjs/common';
import { Socket } from 'socket.io';
import { BridleClientWsHandler } from './bridleClientWs.handler';
import {
  BridleAttachmentKinds,
  BridleAttachmentService,
  BridlePartTypes,
  type BridlePart,
  type IBridleAttachment,
} from '../domain';

/**
 * Covers the socket path only: that a message carrying `attachmentIds` reaches
 * the agent expanded, and that a bad attachment surfaces as an event instead of
 * an exception. The expansion itself is tested in attachment.service.spec.ts —
 * duplicating it here would test the stub, not the handler.
 */

interface ISentToAgent {
  clientId: string;
  agentId: string;
  text: string;
  parts: BridlePart[];
  attachments?: IBridleAttachment[];
}

function makeHandler(expand: BridleAttachmentService['expand']) {
  const sent: ISentToAgent[] = [];
  const hub = {
    sendToAgent: (
      clientId: string,
      agentId: string,
      text: string,
      parts: BridlePart[],
      attachments?: IBridleAttachment[],
    ) => {
      sent.push({ clientId, agentId, text, parts, attachments });
    },
  };
  const attachments = { expand } as BridleAttachmentService;

  const handler = new BridleClientWsHandler(
    hub as never,
    attachments,
    {} as never,
    {} as never,
  );

  const emitted: Array<{ event: string; payload: unknown }> = [];
  const client = {
    data: { clientId: 'admin', agentId: 'agent-1' },
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
      return true;
    },
  } as unknown as Socket;

  return { handler, client, sent, emitted };
}

describe('BridleClientWsHandler — attachments over the socket', () => {
  it('sends the expanded text and parts to the agent', async () => {
    const { handler, client, sent } = makeHandler(
      async (_agentId, baseText, ids) => ({
        text: `${baseText}\n\nfile contents`,
        parts: ids!.map((id) => ({
          type: BridlePartTypes.File as const,
          url: `/api/agent/agent-1/attachment/${id}`,
          name: `${id}.txt`,
        })),
        attachments: [],
      }),
    );

    await handler.handleMessage(client, {
      text: 'look at this',
      attachmentIds: ['a1'],
    });

    expect(sent).toHaveLength(1);
    // The inlined text is what the agent sees — not the text as typed.
    expect(sent[0].text).toBe('look at this\n\nfile contents');
    expect(sent[0].parts).toHaveLength(2);
    expect(sent[0].parts[0]).toEqual({
      type: BridlePartTypes.Text,
      text: 'look at this',
    });
    expect(sent[0].parts[1]).toMatchObject({ name: 'a1.txt' });
  });

  it('forwards the stored-attachment references to the agent', async () => {
    const attachment: IBridleAttachment = {
      id: 'a1',
      name: 'photo.png',
      mimeType: 'image/png',
      size: 9,
      kind: BridleAttachmentKinds.Image,
      url: '/api/agent/agent-1/attachment/a1',
      readableByAgent: true,
    };
    const { handler, client, sent } = makeHandler(async (_a, text) => ({
      text,
      parts: [
        { type: BridlePartTypes.Image, base64: 'AAAA', mediaType: 'image/png' },
      ],
      attachments: [attachment],
    }));

    await handler.handleMessage(client, {
      text: 'look',
      attachmentIds: ['a1'],
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].attachments).toEqual([attachment]);
  });

  it('leaves a plain message untouched', async () => {
    const expand = jest.fn(async (_a: string, text: string) => ({
      text,
      parts: [],
      attachments: [],
    }));
    const { handler, client, sent } = makeHandler(
      expand as unknown as BridleAttachmentService['expand'],
    );

    await handler.handleMessage(client, { text: 'hello' });

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe('hello');
    expect(sent[0].parts).toEqual([
      { type: BridlePartTypes.Text, text: 'hello' },
    ]);
  });

  it('reports a dead attachment to the client without sending anything', async () => {
    const { handler, client, sent, emitted } = makeHandler(async () => {
      throw new BadRequestException('Attachment a1 is no longer available');
    });

    await handler.handleMessage(client, {
      text: 'look at this',
      attachmentIds: ['a1'],
    });

    expect(sent).toHaveLength(0);
    expect(emitted).toEqual([
      {
        event: 'message_error',
        payload: { message: 'Attachment a1 is no longer available' },
      },
    ]);
  });

  it('ignores a message from a socket that never finished its handshake', async () => {
    const expand = jest.fn();
    const { handler, sent } = makeHandler(
      expand as unknown as BridleAttachmentService['expand'],
    );
    const stranger = { data: {}, emit: () => true } as unknown as Socket;

    await handler.handleMessage(stranger, { text: 'hello' });

    expect(sent).toHaveLength(0);
    expect(expand).not.toHaveBeenCalled();
  });
});

/**
 * The handshake decides `kind`, and `kind` is what the attachment ownership
 * rule reads on every later message — so a socket that mislabels itself hands
 * one visitor another's files. These two halves are pinned together: what
 * `handleConnection` writes onto `client.data`, and what `handleMessage`
 * forwards from it.
 */

interface IConnectOptions {
  auth?: Record<string, unknown>;
  origin?: string;
  agent?: { isPublic: boolean; allowedOrigins: string[] } | null;
  /** Stands in for `JwtService.verify`; the default rejects every token. */
  verify?: () => Record<string, unknown>;
}

function makeConnection(options: IConnectOptions) {
  const registered: Array<{ clientId: string; agentId: string }> = [];
  const hub = {
    registerClient: (clientId: string, agentId: string) => {
      registered.push({ clientId, agentId });
    },
    isAgentConnected: () => true,
  };
  const jwt = {
    verify:
      options.verify ??
      (() => {
        throw new Error('invalid token');
      }),
  };
  const agentGateway = {
    findById: () => Promise.resolve(options.agent ?? null),
  };

  const handler = new BridleClientWsHandler(
    hub as never,
    {} as BridleAttachmentService,
    jwt as never,
    agentGateway as never,
  );

  const emitted: Array<{ event: string; payload: unknown }> = [];
  const client = {
    id: 'socket-1',
    data: {},
    handshake: {
      auth: options.auth ?? {},
      headers: options.origin ? { origin: options.origin } : {},
    },
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
      return true;
    },
    disconnect: () => {},
  } as unknown as Socket;

  return { handler, client, emitted, registered };
}

const PUBLIC_AGENT = { isPublic: true, allowedOrigins: ['https://embed.test'] };

describe('BridleClientWsHandler — handshake identity', () => {
  it('stores the JWT sub and kind "jwt" on the socket', async () => {
    const { handler, client, registered } = makeConnection({
      auth: { agentId: 'agent-1', token: 'signed' },
      verify: () => ({ sub: 'u1', email: 'u1@example.test', roles: ['User'] }),
    });

    await handler.handleConnection(client);

    expect(client.data).toEqual({
      clientId: 'u1',
      agentId: 'agent-1',
      email: 'u1@example.test',
      isAdmin: false,
      kind: 'jwt',
    });
    expect(registered).toEqual([{ clientId: 'u1', agentId: 'agent-1' }]);
  });

  it('folds an admin token onto the shared "admin" client id, still kind "jwt"', async () => {
    const { handler, client } = makeConnection({
      auth: { agentId: 'agent-1', token: 'signed' },
      verify: () => ({
        sub: 'u2',
        email: 'boss@example.test',
        roles: ['Owner'],
      }),
    });

    await handler.handleConnection(client);

    expect(client.data).toMatchObject({
      clientId: 'admin',
      isAdmin: true,
      kind: 'jwt',
    });
  });

  it('stores kind "anonymous" for a token-less public-agent visitor', async () => {
    const { handler, client, registered } = makeConnection({
      auth: { agentId: 'agent-1', anonId: 'visitor7' },
      origin: 'https://embed.test',
      agent: PUBLIC_AGENT,
    });

    await handler.handleConnection(client);

    expect(client.data).toEqual({
      clientId: 'anon-visitor7',
      agentId: 'agent-1',
      email: undefined,
      isAdmin: false,
      kind: 'anonymous',
    });
    expect(registered).toEqual([
      { clientId: 'anon-visitor7', agentId: 'agent-1' },
    ]);
  });

  it('keeps kind "anonymous" when a bad token degrades to the public path', async () => {
    const { handler, client } = makeConnection({
      auth: { agentId: 'agent-1', token: 'expired', anonId: 'visitor7' },
      origin: 'https://embed.test',
      agent: PUBLIC_AGENT,
    });

    await handler.handleConnection(client);

    expect(client.data).toMatchObject({
      clientId: 'anon-visitor7',
      kind: 'anonymous',
    });
  });

  it('rejects an expired token on a private agent with TOKEN_EXPIRED so the console can renew', async () => {
    const { handler, client, emitted } = makeConnection({
      auth: { agentId: 'agent-1', token: 'stale' },
      origin: 'https://embed.test',
      agent: { isPublic: false, allowedOrigins: [] },
      verify: () => {
        throw Object.assign(new Error('jwt expired'), {
          name: 'TokenExpiredError',
        });
      },
    });

    await handler.handleConnection(client);

    expect(client.data).toEqual({});
    expect(emitted[0].event).toBe('bridle_error');
    expect(emitted[0].payload).toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('keeps INVALID_TOKEN for a forged token on a private agent', async () => {
    const { handler, client, emitted } = makeConnection({
      auth: { agentId: 'agent-1', token: 'forged' },
      origin: 'https://embed.test',
      agent: { isPublic: false, allowedOrigins: [] },
    });

    await handler.handleConnection(client);

    expect(emitted[0].payload).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('rejects a token-less handshake on a private agent without touching data', async () => {
    const { handler, client, emitted } = makeConnection({
      auth: { agentId: 'agent-1' },
      origin: 'https://embed.test',
      agent: { isPublic: false, allowedOrigins: [] },
    });

    await handler.handleConnection(client);

    expect(client.data).toEqual({});
    expect(emitted[0].event).toBe('bridle_error');
    expect(emitted[0].payload).toMatchObject({ code: 'MISSING_TOKEN' });
  });
});

describe('BridleClientWsHandler — requester forwarded to expand', () => {
  const socket = (data: Record<string, unknown>) =>
    ({ data, emit: () => true }) as unknown as Socket;

  const spyExpand = () =>
    jest.fn(async () => ({ text: 'hi', parts: [], attachments: [] }));

  it('passes the handshake clientId and kind through as the requester', async () => {
    const expand = spyExpand();
    const { handler } = makeHandler(
      expand as unknown as BridleAttachmentService['expand'],
    );

    await handler.handleMessage(
      socket({ clientId: 'u1', agentId: 'agent-1', kind: 'jwt' }),
      { text: 'hi', attachmentIds: ['a1'] },
    );

    expect(expand).toHaveBeenCalledWith('agent-1', 'hi', ['a1'], {
      clientId: 'u1',
      kind: 'jwt',
    });
  });

  it('forwards the share kind unchanged for a share-link visitor', async () => {
    const expand = spyExpand();
    const { handler } = makeHandler(
      expand as unknown as BridleAttachmentService['expand'],
    );

    await handler.handleMessage(
      socket({ clientId: 'share-v7', agentId: 'agent-1', kind: 'share' }),
      { text: 'hi', attachmentIds: ['a1'] },
    );

    expect(expand).toHaveBeenCalledWith('agent-1', 'hi', ['a1'], {
      clientId: 'share-v7',
      kind: 'share',
    });
  });

  it('falls back to anonymous when the socket carries no kind', async () => {
    const expand = spyExpand();
    const { handler } = makeHandler(
      expand as unknown as BridleAttachmentService['expand'],
    );

    await handler.handleMessage(socket({ clientId: 'anon-9', agentId: 'a2' }), {
      text: 'hi',
      attachmentIds: ['a1'],
    });

    expect(expand).toHaveBeenCalledWith('a2', 'hi', ['a1'], {
      clientId: 'anon-9',
      kind: 'anonymous',
    });
  });
});
