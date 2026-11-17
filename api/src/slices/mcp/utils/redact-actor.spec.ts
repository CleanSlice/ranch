import { Logger } from '@nestjs/common';
import { createStreamableHttpController } from '../transport/streamable-http.controller.factory';
import { redactActorToken, REDACTED_ACTOR_TOKEN } from './redact-actor';

/**
 * The acting token never reaches a log (CLEAN-232). Every tools/list and
 * tools/call carries it in `params._meta["ranch/actor"]`, and the streamable
 * HTTP controller logs request bodies at debug level.
 */

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.acting-token-of-the-owner.signature';

const call = (actor: unknown) => ({
  jsonrpc: '2.0',
  id: 7,
  method: 'tools/call',
  params: {
    name: 'delete_agent',
    arguments: { id: 'agent-1', confirm: true },
    _meta: { 'ranch/actor': actor, progressToken: 'p-1' },
  },
});

describe('redactActorToken', () => {
  it('replaces the token and keeps everything else as it was', () => {
    const body = call({ kind: 'person', token: TOKEN });

    expect(redactActorToken(body)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'delete_agent',
        arguments: { id: 'agent-1', confirm: true },
        _meta: {
          'ranch/actor': { kind: 'person', token: REDACTED_ACTOR_TOKEN },
          progressToken: 'p-1',
        },
      },
    });
    expect(JSON.stringify(redactActorToken(body))).not.toContain(TOKEN);
  });

  it('never touches the body the transport is handed', () => {
    const body = call({ kind: 'person', token: TOKEN });

    redactActorToken(body);

    expect(body.params._meta['ranch/actor']).toEqual({
      kind: 'person',
      token: TOKEN,
    });
  });

  it('redacts each message of a batch', () => {
    const batch = [
      call({ kind: 'person', token: TOKEN }),
      { jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} },
      call({ kind: 'person', token: `${TOKEN}-2` }),
    ];

    const logged = JSON.stringify(redactActorToken(batch));

    expect(logged).not.toContain(TOKEN);
    expect(logged).toContain('tools/list');
    expect(logged.split(REDACTED_ACTOR_TOKEN)).toHaveLength(3);
  });

  it('redacts whatever sits under `token`, whatever kind the actor states', () => {
    for (const actor of [
      { kind: 'trusted', token: TOKEN },
      { token: TOKEN },
      { kind: 'person', token: { nested: TOKEN } },
      { kind: 'person', token: null },
    ]) {
      expect(JSON.stringify(redactActorToken(call(actor)))).not.toContain(
        TOKEN,
      );
    }
  });

  it('leaves a body without an actor token exactly as it is', () => {
    const bodies: unknown[] = [
      call({ kind: 'trusted', via: 'internal' }),
      call({ kind: 'guest' }),
      call(undefined),
      call('person'),
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { params: { _meta: null } },
      { params: null },
      [],
      null,
      undefined,
      'not json-rpc',
      42,
    ];
    for (const body of bodies) {
      expect(redactActorToken(body)).toEqual(body);
    }
    // The same object, not a copy, when there is nothing to hide.
    const plain = call({ kind: 'guest' });
    expect(redactActorToken(plain)).toBe(plain);
  });
});

describe('the streamable HTTP controller logs no acting token', () => {
  const body = call({ kind: 'person', token: TOKEN });

  function controller(statelessMode: boolean) {
    const Controller = createStreamableHttpController('mcp/mcp', '');
    const instance = new Controller(
      { name: 'ranch', version: '1', streamableHttp: { statelessMode } },
      'module-id',
      {} as never,
      {} as never,
    );
    // Stop before any transport work: only the logging is under test.
    const stop = new Error('stop here');
    instance.createStatelessServer = () => Promise.reject(stop);
    return { instance, stop };
  }

  const logged = (spy: jest.SpyInstance): string =>
    spy.mock.calls
      .map((args) => args.map((a) => JSON.stringify(a) ?? '').join(' '))
      .join('\n');

  let debug: jest.SpyInstance;
  beforeEach(() => {
    debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('stateless: the body is logged with the token replaced', async () => {
    const { instance, stop } = controller(true);

    await expect(
      instance.handleStatelessRequest({ url: '/mcp/mcp' }, {} as never, body),
    ).rejects.toBe(stop);

    const lines = logged(debug);
    expect(lines).toContain('Handling stateless MCP request');
    expect(lines).toContain('delete_agent');
    expect(lines).toContain(REDACTED_ACTOR_TOKEN);
    expect(lines).not.toContain(TOKEN);
  });

  it('stateful: the same', async () => {
    const { instance } = controller(false);
    const res = { status: () => ({ json: () => undefined }) };

    // No session id and not an initialize request: answered 400, after the
    // body has been logged.
    await instance.handleStatefulRequest(
      { url: '/mcp/mcp', headers: {} } as never,
      res as never,
      body,
    );

    const lines = logged(debug);
    expect(lines).toContain('Handling stateful MCP request');
    expect(lines).toContain('delete_agent');
    expect(lines).toContain(REDACTED_ACTOR_TOKEN);
    expect(lines).not.toContain(TOKEN);
  });

  it('the entry point logs the redacted body too', async () => {
    const { instance } = controller(true);
    const req = { url: '/mcp/mcp', headers: {}, method: 'POST' };
    const res = {
      headersSent: true,
      status: () => res,
      json: () => res,
      on: () => undefined,
    };

    await instance
      .handlePostRequest(req, res, body, 'team')
      .catch(() => undefined);

    const lines = logged(debug);
    expect(lines).toContain('Received MCP request:');
    expect(lines).not.toContain(TOKEN);
  });
});
