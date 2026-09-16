import { BridleSyncService } from './bridleSync.service';
import type { IBridleGateway } from './bridle.gateway';

/**
 * The register/resolve/timeout dance the synchronous chat route has always
 * done, now shared with the A2A server (CLEAN-74). What must hold: exactly one
 * outcome per call, the registration always cleaned up, and a timeout reported
 * as a flag rather than smuggled back as if it were the agent's answer.
 */
type Send = (data: unknown) => void;

function makeHarness() {
  const registrations: Array<{
    clientId: string;
    agentId: string;
    socketId: string;
    isAdmin: boolean;
    capabilities?: string[];
  }> = [];
  const unregistrations: Array<{
    clientId: string;
    agentId: string;
    socketId: string;
  }> = [];
  const sends: Array<Record<string, unknown>> = [];
  let emit: Send = () => {};

  const hub = {
    registerClient: jest.fn(
      (
        clientId: string,
        agentId: string,
        socketId: string,
        send: Send,
        isAdmin: boolean,
        _prompt?: string,
        capabilities?: string[],
      ) => {
        registrations.push({
          clientId,
          agentId,
          socketId,
          isAdmin,
          capabilities,
        });
        emit = send;
      },
    ),
    unregisterClient: jest.fn(
      (clientId: string, agentId: string, socketId: string) => {
        unregistrations.push({ clientId, agentId, socketId });
      },
    ),
    sendToAgent: jest.fn(
      (
        clientId: string,
        agentId: string,
        text: string,
        parts: unknown,
        attachments: unknown,
      ) => {
        sends.push({ clientId, agentId, text, parts, attachments });
      },
    ),
  } as unknown as IBridleGateway;

  const service = new BridleSyncService(hub);
  return {
    service,
    hub,
    registrations,
    unregistrations,
    sends,
    emit: (data: unknown) => emit(data),
  };
}

const base = { agentId: 'agent-1', clientId: 'peer:caller:ctx-1', text: 'hi' };

describe('BridleSyncService.sendAndAwait', () => {
  beforeEach(() => jest.useRealTimers());

  it('resolves on a plain message', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait(base);
    h.emit({ type: 'message', text: 'the answer', messageId: 'm1', ts: 42 });

    await expect(pending).resolves.toEqual({
      text: 'the answer',
      messageId: 'm1',
      ts: 42,
      timedOut: false,
    });
  });

  it('accumulates stream chunks and resolves on stream_end', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait(base);
    h.emit({ type: 'stream', text: 'the ' });
    h.emit({ type: 'stream', text: 'answer' });
    h.emit({ type: 'stream_end', messageId: 'm2', ts: 7 });

    await expect(pending).resolves.toMatchObject({
      text: 'the answer',
      messageId: 'm2',
      timedOut: false,
    });
  });

  it('prefers the terminal event text over the accumulated chunks', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait(base);
    h.emit({ type: 'stream', text: 'partial' });
    h.emit({ type: 'message', text: 'final', messageId: 'm3', ts: 9 });

    await expect(pending).resolves.toMatchObject({ text: 'final' });
  });

  it('sends the message to the agent after registering to hear the reply', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait({ ...base, parts: [] });
    h.emit({ type: 'message', text: 'ok', messageId: 'm', ts: 1 });
    await pending;

    expect(h.registrations).toHaveLength(1);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]).toMatchObject({
      clientId: 'peer:caller:ctx-1',
      agentId: 'agent-1',
      text: 'hi',
    });
  });

  it('registers under its own socket id so a live tab is never unregistered', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait(base);
    h.emit({ type: 'message', text: 'ok', messageId: 'm', ts: 1 });
    await pending;

    expect(h.registrations[0].socketId).toMatch(/^sync-/);
    expect(h.registrations[0].socketId).not.toBe(h.registrations[0].clientId);
    expect(h.unregistrations[0].socketId).toBe(h.registrations[0].socketId);
  });

  it('declares no capabilities by default, so a peer gets no thinking stream', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait(base);
    h.emit({ type: 'message', text: 'ok', messageId: 'm', ts: 1 });
    await pending;

    expect(h.registrations[0].capabilities).toEqual([]);
    expect(h.registrations[0].isAdmin).toBe(false);
  });

  it('passes the caller capabilities through when it has some', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait({
      ...base,
      capabilities: ['streaming', 'thinking'],
      isAdmin: true,
    });
    h.emit({ type: 'message', text: 'ok', messageId: 'm', ts: 1 });
    await pending;

    expect(h.registrations[0].capabilities).toEqual(['streaming', 'thinking']);
    expect(h.registrations[0].isAdmin).toBe(true);
  });

  it('reports a timeout as a flag and unregisters', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait({ ...base, timeoutMs: 5 });

    await expect(pending).resolves.toMatchObject({
      text: '',
      messageId: '',
      timedOut: true,
    });
    expect(h.unregistrations).toHaveLength(1);
  });

  it('returns what had streamed in when the wait runs out mid-answer', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait({ ...base, timeoutMs: 20 });
    h.emit({ type: 'stream', text: 'half an ans' });

    await expect(pending).resolves.toMatchObject({
      text: 'half an ans',
      timedOut: true,
    });
  });

  it('ignores a late reply after a timeout instead of resolving twice', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait({ ...base, timeoutMs: 5 });
    const first = await pending;
    h.emit({ type: 'message', text: 'too late', messageId: 'm', ts: 1 });

    expect(first.timedOut).toBe(true);
    expect(h.unregistrations).toHaveLength(1);
  });

  it('unregisters exactly once when several terminal events arrive', async () => {
    const h = makeHarness();

    const pending = h.service.sendAndAwait(base);
    h.emit({ type: 'message', text: 'first', messageId: 'm1', ts: 1 });
    h.emit({ type: 'stream_end', text: 'second', messageId: 'm2', ts: 2 });
    await pending;

    expect(h.unregistrations).toHaveLength(1);
  });
});
