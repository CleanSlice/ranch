import type { Socket } from 'socket.io';
import { BridleClientWsHandler } from './bridleClientWs.handler';
import type { BridleAttachmentService, IBridleSendOptions } from '../domain';

/**
 * What the browser is told about a message it sent (CLEAN-102). The value
 * `handleMessage` returns is the socket.io acknowledgement: Nest passes it to
 * the callback the browser supplied. Before this, a send was fire-and-forget
 * and a bubble looked the same whether or not anyone received it.
 */
function makeHandler(expand: BridleAttachmentService['expand']) {
  const forwarded: Array<IBridleSendOptions | undefined> = [];
  const hub = {
    sendToAgent: (
      _clientId: string,
      _agentId: string,
      _text: string,
      _parts: unknown[],
      _attachments: unknown,
      options?: IBridleSendOptions,
    ) => {
      forwarded.push(options);
      return { status: 'accepted', messageId: 'from-hub', ts: 42 };
    },
  };
  const handler = new BridleClientWsHandler(
    hub as never,
    { expand } as BridleAttachmentService,
    {} as never,
    {} as never,
    {} as never,
  );
  const emitted: string[] = [];
  const client = {
    id: 'socket-1',
    data: { clientId: 'admin', agentId: 'agent-1' },
    emit: (event: string) => {
      emitted.push(event);
      return true;
    },
    disconnect: () => undefined,
  } as unknown as Socket;
  return { handler, client, forwarded, emitted };
}

const passThrough: BridleAttachmentService['expand'] = async (_a, text) => ({
  text,
  parts: [],
  attachments: [],
});

describe('BridleClientWsHandler — acknowledging a sent message', () => {
  it('answers with what the hub decided', async () => {
    const { handler, client } = makeHandler(passThrough);

    const ack = await handler.handleMessage(client, {
      text: 'hello',
      clientMessageId: 'c1',
    });

    expect(ack).toEqual({ status: 'accepted', messageId: 'from-hub', ts: 42 });
  });

  it('asks the hub for an honest outcome only when the browser minted an id', async () => {
    const { handler, client, forwarded } = makeHandler(passThrough);

    await handler.handleMessage(client, {
      text: 'hello',
      clientMessageId: 'c1',
    });
    await handler.handleMessage(client, { text: 'from the embed widget' });

    expect(forwarded[0]).toMatchObject({
      socketId: 'socket-1',
      clientMessageId: 'c1',
      withAck: true,
      displayText: 'hello',
    });
    expect(forwarded[1]?.withAck).toBeUndefined();
    expect(forwarded[1]?.clientMessageId).toBeUndefined();
  });

  it('rejects a message with nothing in it', async () => {
    const { handler, client, forwarded } = makeHandler(passThrough);

    const ack = await handler.handleMessage(client, {
      text: '',
      clientMessageId: 'c1',
    });

    expect(ack).toEqual({ status: 'rejected', code: 'EMPTY' });
    expect(forwarded).toHaveLength(0);
  });

  it('rejects when an attachment cannot be read, and still raises the notice', async () => {
    const { handler, client, emitted } = makeHandler(async () => {
      throw new Error('file is gone');
    });

    const ack = await handler.handleMessage(client, {
      text: 'look',
      attachmentIds: ['a1'],
      clientMessageId: 'c1',
    });

    expect(ack).toEqual({
      status: 'rejected',
      code: 'ATTACHMENT_FAILED',
      message: 'file is gone',
    });
    expect(emitted).toEqual(['message_error']);
  });
});
