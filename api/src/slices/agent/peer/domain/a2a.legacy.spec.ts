import {
  A2aDialects,
  A2A_LEGACY_VERSION,
  fromLegacyResult,
  isLegacyVersion,
  normalizeLegacyCard,
  selectCallableInterface,
  toLegacySendParams,
} from './a2a.legacy';
import {
  A2aRoles,
  A2aTaskStates,
  type IA2aAgentCard,
  type IA2aSendMessageParams,
} from './a2a.types';

/**
 * The old dialect, both directions (CLEAN-114). These cases are the contract
 * with agents nobody here controls, so each one pins a difference a real 0.3
 * server actually has: where it names its address, how it spells a role, a
 * state, a file. Being generous on the way in is deliberate — a reply we half
 * understand beats "answered with something unreadable".
 */
const legacyCard = (extra: Record<string, unknown> = {}) => ({
  protocolVersion: '0.3.0',
  name: 'Legacy Agent',
  description: 'Answers questions.',
  url: 'https://legacy.example/a2a',
  preferredTransport: 'JSONRPC',
  version: '1.0.0',
  skills: [{ id: 's1', name: 'Ask', description: 'Answers', tags: [] }],
  ...extra,
});

const modernCard = (
  interfaces: IA2aAgentCard['supportedInterfaces'],
): IA2aAgentCard =>
  ({
    name: 'Modern',
    description: '',
    version: '1',
    supportedInterfaces: interfaces,
    capabilities: {},
    defaultInputModes: [],
    defaultOutputModes: [],
    skills: [],
  }) as IA2aAgentCard;

describe('normalizeLegacyCard', () => {
  it('turns a top-level url into the one interface, keeping the declared version', () => {
    const card = normalizeLegacyCard(legacyCard());

    expect(card?.supportedInterfaces).toEqual([
      {
        url: 'https://legacy.example/a2a',
        protocolBinding: 'JSONRPC',
        protocolVersion: '0.3.0',
      },
    ]);
    expect(card?.name).toBe('Legacy Agent');
    expect(card?.skills).toHaveLength(1);
  });

  it('assumes the old version when the card names none', () => {
    const card = normalizeLegacyCard(
      legacyCard({ protocolVersion: undefined }),
    );

    expect(card?.supportedInterfaces[0].protocolVersion).toBe(
      A2A_LEGACY_VERSION,
    );
  });

  it('assumes JSON-RPC when the card names no transport', () => {
    const card = normalizeLegacyCard(
      legacyCard({ preferredTransport: undefined }),
    );

    expect(card?.supportedInterfaces[0].protocolBinding).toBe('JSONRPC');
  });

  it('puts a JSON-RPC extra interface ahead of a preferred gRPC one', () => {
    const card = normalizeLegacyCard(
      legacyCard({
        preferredTransport: 'GRPC',
        additionalInterfaces: [
          { url: 'https://legacy.example/rpc', transport: 'JSONRPC' },
        ],
      }),
    );

    expect(card?.supportedInterfaces.map((i) => i.url)).toEqual([
      'https://legacy.example/rpc',
      'https://legacy.example/a2a',
    ]);
  });

  it('reads the modes a 0.3 card writes in snake_case', () => {
    const card = normalizeLegacyCard(
      legacyCard({
        default_input_modes: ['text'],
        default_output_modes: ['text'],
      }),
    );

    expect(card?.defaultInputModes).toEqual(['text']);
    expect(card?.defaultOutputModes).toEqual(['text']);
  });

  it.each([
    ['a 1.0 card', { ...legacyCard(), supportedInterfaces: [] }],
    ['a card with no address', { ...legacyCard(), url: undefined }],
    ['a card with a blank address', { ...legacyCard(), url: '   ' }],
    ['a document with no skills', { ...legacyCard(), skills: undefined }],
    ['something that is not an object', 'nope'],
  ])('leaves %s alone', (_label, value) => {
    expect(normalizeLegacyCard(value)).toBeNull();
  });
});

describe('selectCallableInterface', () => {
  it('prefers 1.0 over the old dialect', () => {
    const chosen = selectCallableInterface(
      modernCard([
        {
          url: 'https://x.example/old',
          protocolBinding: 'JSONRPC',
          protocolVersion: '0.3',
        },
        {
          url: 'https://x.example/new',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ]),
    );

    expect(chosen).toEqual({
      iface: expect.objectContaining({ url: 'https://x.example/new' }),
      dialect: A2aDialects.V1,
    });
  });

  it('takes a 0.x JSON-RPC interface as the old dialect', () => {
    const chosen = selectCallableInterface(
      modernCard([
        {
          url: 'https://x.example/old',
          protocolBinding: 'JSONRPC',
          protocolVersion: '0.2.9',
        },
      ]),
    );

    expect(chosen?.dialect).toBe(A2aDialects.Legacy);
  });

  it('refuses a version it has never heard of rather than guessing', () => {
    expect(
      selectCallableInterface(
        modernCard([
          {
            url: 'https://x.example/future',
            protocolBinding: 'JSONRPC',
            protocolVersion: '2.0',
          },
        ]),
      ),
    ).toBeNull();
  });

  it('refuses a card that speaks no JSON-RPC at all', () => {
    expect(
      selectCallableInterface(
        modernCard([
          {
            url: 'https://x.example/rest',
            protocolBinding: 'HTTP+JSON',
            protocolVersion: '1.0',
          },
        ]),
      ),
    ).toBeNull();
  });

  it('treats an unversioned JSON-RPC interface as old', () => {
    expect(isLegacyVersion(undefined)).toBe(true);
    expect(isLegacyVersion('')).toBe(true);
    expect(isLegacyVersion('0.3.0')).toBe(true);
    expect(isLegacyVersion('1.0')).toBe(false);
    expect(isLegacyVersion('2.0')).toBe(false);
  });
});

describe('toLegacySendParams', () => {
  const params = (): IA2aSendMessageParams => ({
    message: {
      messageId: 'm-1',
      role: A2aRoles.User,
      parts: [{ text: 'What is the return window?' }],
      contextId: 'ctx-1',
      metadata: { ranch: { chain: ['a'], reason: 'why' } },
    },
    configuration: {
      acceptedOutputModes: ['text/plain'],
      returnImmediately: false,
    },
  });

  it('spells the message the way 0.3 does', () => {
    expect(toLegacySendParams(params())).toMatchObject({
      message: {
        kind: 'message',
        messageId: 'm-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'What is the return window?' }],
        contextId: 'ctx-1',
      },
    });
  });

  it('asks for the answer, not a task id — 1.0 inverted that flag', () => {
    expect(toLegacySendParams(params())).toMatchObject({
      configuration: { blocking: true, acceptedOutputModes: ['text/plain'] },
    });

    const immediate = params();
    immediate.configuration!.returnImmediately = true;
    expect(toLegacySendParams(immediate)).toMatchObject({
      configuration: { blocking: false },
    });
  });

  it('tags data and file parts with the kind 0.3 expects', () => {
    const withParts = params();
    withParts.message.parts = [
      { data: { a: 1 } },
      {
        url: 'https://x.example/f.pdf',
        filename: 'f.pdf',
        mediaType: 'application/pdf',
      },
      { raw: 'YmFzZTY0', filename: 'b.bin' },
    ];

    expect(toLegacySendParams(withParts)).toMatchObject({
      message: {
        parts: [
          { kind: 'data', data: { a: 1 } },
          {
            kind: 'file',
            file: {
              uri: 'https://x.example/f.pdf',
              name: 'f.pdf',
              mimeType: 'application/pdf',
            },
          },
          { kind: 'file', file: { bytes: 'YmFzZTY0', name: 'b.bin' } },
        ],
      },
    });
  });
});

describe('fromLegacyResult', () => {
  it('reads a finished task, states and parts and all', () => {
    const reply = fromLegacyResult({
      kind: 'task',
      id: 't-1',
      contextId: 'ctx-1',
      status: {
        state: 'completed',
        timestamp: '2026-09-24T10:00:00Z',
      },
      artifacts: [
        {
          artifactId: 'a-1',
          name: 'reply',
          parts: [{ kind: 'text', text: 'Thirty days.' }],
        },
      ],
    });

    expect(reply).toEqual({
      task: expect.objectContaining({
        id: 't-1',
        contextId: 'ctx-1',
        status: expect.objectContaining({
          state: A2aTaskStates.Completed,
          timestamp: '2026-09-24T10:00:00Z',
        }),
        artifacts: [
          expect.objectContaining({
            artifactId: 'a-1',
            name: 'reply',
            parts: [{ text: 'Thirty days.' }],
          }),
        ],
      }),
    });
  });

  it.each([
    ['working', A2aTaskStates.Working],
    ['input-required', A2aTaskStates.InputRequired],
    ['auth-required', A2aTaskStates.AuthRequired],
    ['cancelled', A2aTaskStates.Canceled],
    ['rejected', A2aTaskStates.Rejected],
    ['something new', A2aTaskStates.Unspecified],
    ['TASK_STATE_COMPLETED', A2aTaskStates.Completed],
  ])('maps the state %s', (state, expected) => {
    const reply = fromLegacyResult({ id: 't', status: { state } });

    expect(reply).toMatchObject({ task: { status: { state: expected } } });
  });

  it('carries the message a failed task explains itself with', () => {
    const reply = fromLegacyResult({
      id: 't',
      status: {
        state: 'failed',
        message: {
          role: 'agent',
          messageId: 'm-9',
          parts: [{ kind: 'text', text: 'I need a city.' }],
        },
      },
    });

    expect(reply).toMatchObject({
      task: {
        status: {
          state: A2aTaskStates.Failed,
          message: {
            role: A2aRoles.Agent,
            parts: [{ text: 'I need a city.' }],
          },
        },
      },
    });
  });

  it('reads a direct message reply, which is what most public agents send', () => {
    const reply = fromLegacyResult({
      kind: 'message',
      messageId: 'm-2',
      role: 'agent',
      parts: [{ kind: 'text', text: 'Hello.' }],
    });

    expect(reply).toEqual({
      message: expect.objectContaining({
        messageId: 'm-2',
        role: A2aRoles.Agent,
        parts: [{ text: 'Hello.' }],
      }),
    });
  });

  it('unwraps data and file parts', () => {
    const reply = fromLegacyResult({
      role: 'agent',
      parts: [
        { kind: 'data', data: { facilities: 3 } },
        {
          kind: 'file',
          file: { uri: 'https://x.example/r.pdf', name: 'r.pdf' },
        },
        {
          kind: 'file',
          file: { bytes: 'YmFzZTY0', mimeType: 'application/zip' },
        },
      ],
    });

    expect(reply).toMatchObject({
      message: {
        parts: [
          { data: { facilities: 3 } },
          { url: 'https://x.example/r.pdf', filename: 'r.pdf' },
          { raw: 'YmFzZTY0', mediaType: 'application/zip' },
        ],
      },
    });
  });

  it('accepts a part that forgot its kind, because servers do', () => {
    const reply = fromLegacyResult({
      role: 'agent',
      parts: [{ text: 'no kind here' }],
    });

    expect(reply).toMatchObject({
      message: { parts: [{ text: 'no kind here' }] },
    });
  });

  it.each([
    ['neither a task nor a message', { something: 'else' }],
    ['a string', 'nope'],
    ['nothing at all', null],
  ])('returns null for %s', (_label, value) => {
    expect(fromLegacyResult(value)).toBeNull();
  });
});
