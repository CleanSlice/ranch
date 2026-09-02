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
