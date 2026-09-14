/* eslint-disable @typescript-eslint/unbound-method --
 * Nest's Reflector reads metadata off the method reference itself, so
 * `Controller.prototype.handler` is the argument it wants; nothing is ever
 * called detached. Same pattern as shareLink.controller.spec.
 */
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { A2aController } from './a2a.controller';
import { A2aCardGuard, A2aPeerGuard } from './guards/a2a.guards';
import type { IA2aRequest } from './guards/a2a.guards';
import { RAW_RESPONSE_METADATA_KEY } from '#/setup/error/rawResponse.decorator';
import {
  A2aErrorCodes,
  A2aRpcError,
  A2aTaskStates,
  type IA2aTask,
} from './domain/a2a.types';
import type { AgentCardService } from './domain/agentCard.service';
import type { A2aServerService } from './domain/a2a.server.service';

/**
 * The JSON-RPC edge. Its job is translation, so these cases are about shapes:
 * a protocol error must arrive as a JSON-RPC error object (the spec's clients
 * read `error.code`, not HTTP status), an unsupported-but-real method must be
 * distinguishable from a typo, and neither route may be wrapped in Ranch's own
 * `{ success, data }` envelope.
 */
const task = (id = 't1'): IA2aTask => ({
  id,
  contextId: 'ctx-1',
  status: { state: A2aTaskStates.Completed, timestamp: '2026-09-14T10:00:00Z' },
  artifacts: [{ artifactId: 'reply', parts: [{ text: 'the answer' }] }],
  history: [],
  metadata: { ranch: { chain: ['agent-a', 'agent-b'] } },
});

function makeController(
  options: {
    sendMessage?: () => Promise<IA2aTask>;
    getTask?: () => IA2aTask;
    knowsTask?: boolean;
  } = {},
) {
  // Raw mocks; cast only at the constructor. Reading a method off a casted
  // interface is what @typescript-eslint/unbound-method objects to.
  const cardMocks = {
    build: jest.fn(async () => ({ name: 'Support Bot' })),
  };

  const serverMocks = {
    sendMessage: jest.fn(options.sendMessage ?? (async () => task())),
    getTask: jest.fn(
      options.getTask ??
        (() => {
          throw new A2aRpcError(A2aErrorCodes.TaskNotFound, 'Task not found');
        }),
    ),
    knowsTask: jest.fn(() => options.knowsTask ?? false),
  };

  const controller = new A2aController(
    cardMocks as unknown as AgentCardService,
    serverMocks as unknown as A2aServerService,
  );
  const request = {
    peer: { peerId: 'p1', callerAgentId: 'agent-a' },
  } as IA2aRequest;

  const rpc = (body: unknown) =>
    controller.rpc('agent-b', request, body, '1.0');
  // Separate on purpose: a default parameter would swallow the "no header
  // at all" case, which is precisely the one the spec treats as A2A 0.3.
  const rpcWithVersion = (body: unknown, version: string | undefined) =>
    controller.rpc('agent-b', request, body, version);

  return {
    controller,
    cards: cardMocks,
    server: serverMocks,
    rpc,
    rpcWithVersion,
  };
}

const call = (method: string, params?: unknown, id: unknown = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

describe('A2aController — wiring', () => {
  it('guards the card with the card guard and the RPC route with the peer guard', () => {
    const reflector = new Reflector();

    expect(
      reflector.get(GUARDS_METADATA, A2aController.prototype.card),
    ).toEqual([A2aCardGuard]);
    expect(reflector.get(GUARDS_METADATA, A2aController.prototype.rpc)).toEqual(
      [A2aPeerGuard],
    );
  });

  it('answers both routes outside the Ranch response envelope', () => {
    const reflector = new Reflector();

    expect(
      reflector.get(RAW_RESPONSE_METADATA_KEY, A2aController.prototype.card),
    ).toBe(true);
    expect(
      reflector.get(RAW_RESPONSE_METADATA_KEY, A2aController.prototype.rpc),
    ).toBe(true);
  });

  it('hands back the card exactly as built', async () => {
    const { controller, cards } = makeController();

    await expect(controller.card('agent-b')).resolves.toEqual({
      name: 'Support Bot',
    });
    expect(cards.build).toHaveBeenCalledWith('agent-b');
  });
});

describe('A2aController — version handshake', () => {
  it('refuses a request that does not say which protocol version it speaks', async () => {
    const { rpcWithVersion } = makeController();

    const response = await rpcWithVersion(call('SendMessage'), undefined);

    expect(response.error?.code).toBe(A2aErrorCodes.VersionNotSupported);
    expect(response.result).toBeUndefined();
  });

  it('refuses a version this server does not speak', async () => {
    const { rpcWithVersion, server } = makeController();

    const response = await rpcWithVersion(call('SendMessage'), '0.3.0');

    expect(response.error?.code).toBe(A2aErrorCodes.VersionNotSupported);
    expect(server.sendMessage).not.toHaveBeenCalled();
  });
});

describe('A2aController — dispatch', () => {
  it('sends a message on behalf of the agent the credential named', async () => {
    const { rpc, server } = makeController();

    const response = await rpc(call('SendMessage', { message: { parts: [] } }));

    expect(response.result).toEqual({ task: task() });
    expect(server.sendMessage).toHaveBeenCalledWith('agent-b', 'agent-a', {
      message: { parts: [] },
    });
  });

  it('reports a failed task as a result, not as an error', async () => {
    const failed: IA2aTask = {
      ...task(),
      status: {
        state: A2aTaskStates.Failed,
        timestamp: '2026-09-14T10:00:00Z',
        message: {
          messageId: 'm',
          role: 'ROLE_AGENT',
          parts: [{ text: 'peer not running' }],
        },
      },
      artifacts: [],
    };
    const { rpc } = makeController({ sendMessage: async () => failed });

    const response = await rpc(call('SendMessage', { message: { parts: [] } }));

    // A failure of the work is still a successful protocol exchange — the
    // caller has to be able to read the cause off the task.
    expect(response.error).toBeUndefined();
    expect((response.result as { task: IA2aTask }).task.status.state).toBe(
      A2aTaskStates.Failed,
    );
  });

  it('returns a known task', async () => {
    const { rpc } = makeController({ getTask: () => task('t7') });

    const response = await rpc(call('GetTask', { id: 't7' }));

    expect((response.result as { task: IA2aTask }).task.id).toBe('t7');
  });

  it('says an unknown task is not found', async () => {
    const { rpc } = makeController();

    const response = await rpc(call('GetTask', { id: 'nope' }));

    expect(response.error?.code).toBe(A2aErrorCodes.TaskNotFound);
  });

  it('tells a cancel of an unknown task apart from one it cannot cancel', async () => {
    const unknown = await makeController({ knowsTask: false }).rpc(
      call('CancelTask', { id: 'x' }),
    );
    const known = await makeController({ knowsTask: true }).rpc(
      call('CancelTask', { id: 'x' }),
    );

    expect(unknown.error?.code).toBe(A2aErrorCodes.TaskNotFound);
    expect(known.error?.code).toBe(A2aErrorCodes.TaskNotCancelable);
  });

  it('answers a real method it does not implement with "unsupported"', async () => {
    const { rpc } = makeController();

    const response = await rpc(call('SendStreamingMessage'));

    expect(response.error?.code).toBe(A2aErrorCodes.UnsupportedOperation);
    expect(response.error?.message).toContain('SendStreamingMessage');
  });

  it('answers every other unimplemented protocol method the same way', async () => {
    const { rpc } = makeController();

    for (const method of [
      'SubscribeToTask',
      'ListTasks',
      'CreateTaskPushNotificationConfig',
      'GetExtendedAgentCard',
    ]) {
      const response = await rpc(call(method));
      expect(response.error?.code).toBe(A2aErrorCodes.UnsupportedOperation);
    }
  });

  it('answers a method that is not in the protocol with "method not found"', async () => {
    const { rpc } = makeController();

    const response = await rpc(call('DoSomethingElse'));

    expect(response.error?.code).toBe(A2aErrorCodes.MethodNotFound);
  });
});

describe('A2aController — malformed input', () => {
  it('refuses a body that is not a JSON-RPC request', async () => {
    const { rpc } = makeController();

    await expect(rpc({ hello: 'world' })).resolves.toMatchObject({
      error: { code: A2aErrorCodes.InvalidRequest },
    });
    await expect(rpc(null)).resolves.toMatchObject({
      error: { code: A2aErrorCodes.InvalidRequest },
    });
  });

  it('echoes the request id back, including a null one', async () => {
    const { rpc } = makeController();

    await expect(
      rpc(call('DoSomethingElse', undefined, 'abc')),
    ).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 'abc',
    });
    await expect(rpc({ hello: 'world' })).resolves.toMatchObject({ id: null });
  });

  it('turns an unexpected failure into an internal error rather than a crash', async () => {
    const { rpc } = makeController({
      sendMessage: async () => {
        throw new Error('database on fire');
      },
    });

    const response = await rpc(call('SendMessage', { message: { parts: [] } }));

    expect(response.error?.code).toBe(A2aErrorCodes.Internal);
    expect(response.error?.message).toBe('database on fire');
  });
});
