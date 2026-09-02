import { BridleGateway } from './bridle.gateway';
import { BridleAttachmentKinds, BridlePartTypes } from '../domain';
import type { BridlePart, IBridleAttachment } from '../domain';

/**
 * Covers what crosses the hub → runtime wire for a message with stored
 * attachments: references travel as metadata only. The url is this API's own
 * route (useless to the runtime) and readableByAgent is a UI concern — the
 * runtime persists the array verbatim into the transcript, so anything extra
 * sent here would leak into every replay.
 */
describe('BridleGateway.sendToAgent', () => {
  const attachment: IBridleAttachment = {
    id: 'a1',
    name: 'photo.png',
    mimeType: 'image/png',
    size: 9,
    kind: BridleAttachmentKinds.Image,
    url: '/api/agent/agent-1/attachment/a1',
    readableByAgent: true,
  };
  const parts: BridlePart[] = [
    { type: BridlePartTypes.Text, text: 'look' },
  ];

  function connectedAgent() {
    const gateway = new BridleGateway();
    const received: Array<Record<string, unknown>> = [];
    gateway.registerAgent('agent-1', 'socket-1', (data) =>
      received.push(data as Record<string, unknown>),
    );
    return { gateway, received };
  }

  it('sends attachment references as metadata only', () => {
    const { gateway, received } = connectedAgent();

    gateway.sendToAgent('admin', 'agent-1', 'look', parts, [attachment]);

    expect(received).toHaveLength(1);
    expect(received[0].attachments).toEqual([
      {
        id: 'a1',
        name: 'photo.png',
        mimeType: 'image/png',
        size: 9,
        kind: BridleAttachmentKinds.Image,
      },
    ]);
  });

  it('omits the attachments key entirely for plain messages', () => {
    const { gateway, received } = connectedAgent();

    gateway.sendToAgent('admin', 'agent-1', 'hello', parts);

    expect(received).toHaveLength(1);
    expect('attachments' in received[0]).toBe(false);
  });
});
