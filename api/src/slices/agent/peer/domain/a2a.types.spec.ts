import {
  renderReplyParts,
  replyTextOfTask,
  selectJsonRpcInterface,
  type IA2aTask,
} from './a2a.types';

/**
 * The two decisions every external delegation leans on (CLEAN-97): which of a
 * card's interfaces Ranch dials, and what of a peer's reply the calling model
 * gets to read. Both are pure, so they are pinned here directly as well as
 * through the services that use them.
 */
describe('selectJsonRpcInterface', () => {
  it('picks the first JSON-RPC interface on 1.0, not simply the first one', () => {
    const iface = selectJsonRpcInterface({
      supportedInterfaces: [
        {
          url: 'https://x/grpc',
          protocolBinding: 'GRPC',
          protocolVersion: '1.0',
        },
        {
          url: 'https://x/rpc-a',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
        {
          url: 'https://x/rpc-b',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ],
    });

    expect(iface?.url).toBe('https://x/rpc-a');
  });

  it('ignores a JSON-RPC interface on another protocol version', () => {
    expect(
      selectJsonRpcInterface({
        supportedInterfaces: [
          {
            url: 'https://x/old',
            protocolBinding: 'JSONRPC',
            protocolVersion: '0.3',
          },
        ],
      }),
    ).toBeNull();
  });

  it('accepts the binding name in any letter case', () => {
    expect(
      selectJsonRpcInterface({
        supportedInterfaces: [
          {
            url: 'https://x/rpc',
            protocolBinding: 'jsonrpc',
            protocolVersion: '1.0',
          },
        ],
      })?.url,
    ).toBe('https://x/rpc');
  });

  it('survives a card with no interfaces or a malformed entry', () => {
    expect(selectJsonRpcInterface(null)).toBeNull();
    expect(selectJsonRpcInterface({ supportedInterfaces: [] })).toBeNull();
    expect(
      selectJsonRpcInterface({
        supportedInterfaces: [
          { protocolBinding: 'JSONRPC', protocolVersion: '1.0' } as never,
        ],
      }),
    ).toBeNull();
  });
});

describe('renderReplyParts', () => {
  it('passes text through, trimmed, and separates parts with a blank line', () => {
    expect(renderReplyParts([{ text: '  one  ' }, { text: 'two' }])).toBe(
      'one\n\ntwo',
    );
  });

  it('turns structured data into compact JSON', () => {
    expect(renderReplyParts([{ data: { a: 1, b: ['x'] } }])).toBe(
      '{"a":1,"b":["x"]}',
    );
  });

  it('treats empty data as nothing rather than as "{}"', () => {
    expect(renderReplyParts([{ data: {} }, { data: [] }, { data: null }])).toBe(
      '',
    );
  });

  it('keeps a link, labelled by its file name when there is one', () => {
    expect(
      renderReplyParts([
        { url: 'https://x/a' },
        { url: 'https://x/b', filename: 'b.html' },
      ]),
    ).toBe('https://x/a\n\nb.html: https://x/b');
  });

  it('names a binary part instead of pasting base64 into a prompt', () => {
    expect(renderReplyParts([{ raw: 'QUJD', mediaType: 'image/png' }])).toBe(
      '[binary attachment not included: image/png]',
    );
  });

  it('skips shapes it does not recognise', () => {
    expect(
      renderReplyParts([{ something: 'else' } as never, { text: 'ok' }]),
    ).toBe('ok');
    expect(renderReplyParts(undefined)).toBe('');
  });
});

describe('replyTextOfTask', () => {
  const base: IA2aTask = {
    id: 't',
    contextId: 'c',
    status: {
      state: 'TASK_STATE_COMPLETED',
      timestamp: '2026-09-17T00:00:00Z',
    },
    artifacts: [],
    history: [],
  };

  it('reads every artifact in order', () => {
    expect(
      replyTextOfTask({
        ...base,
        artifacts: [
          { artifactId: 'a', parts: [{ text: 'first' }] },
          { artifactId: 'b', parts: [{ data: { n: 2 } }] },
        ],
      }),
    ).toBe('first\n\n{"n":2}');
  });

  it('falls back to the status message only when the artifacts say nothing', () => {
    const status = {
      ...base.status,
      message: {
        messageId: 's',
        role: 'ROLE_AGENT' as const,
        parts: [{ text: 'status words' }],
      },
    };

    expect(replyTextOfTask({ ...base, status })).toBe('status words');
    expect(
      replyTextOfTask({
        ...base,
        status,
        artifacts: [{ artifactId: 'a', parts: [{ text: 'artifact words' }] }],
      }),
    ).toBe('artifact words');
  });

  it('is empty when nothing anywhere is readable', () => {
    expect(
      replyTextOfTask({
        ...base,
        artifacts: [{ artifactId: 'a', parts: [{ data: {} }] }],
      }),
    ).toBe('');
  });
});
