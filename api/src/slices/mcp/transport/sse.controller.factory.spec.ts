/**
 * The SSE messages route has one way to run a tool: hand the message to the
 * session's transport, after the executor registered the handlers for this
 * request. That is where a call meets the party, the audience and the
 * caller's tool policy (`McpToolsHandler`).
 *
 * It used to have a second one (CLEAN-263): a "restored session" branch that
 * looked the tool up in the registry and called its method on the bare
 * request, with none of the three. It ran when the session went away while
 * the executor was being resolved. These specs hold the route to the one
 * way, for a session that is unknown and for one that closes mid-request.
 */
import type { ModuleRef } from '@nestjs/core';
import type { Request, Response } from 'express';
import { McpExecutorService } from '../services/mcp-executor.service';
import { createSseController } from './sse.controller.factory';

const SESSION = 'session-1';

/** A tool as the registry would hold it; nothing here may ever call it. */
class SomeTool {
  restart = jest.fn();
}

function harness() {
  const tool = new SomeTool();
  const executor = { registerRequestHandlers: jest.fn() };
  const resolve = jest.fn((token: unknown) =>
    Promise.resolve(token === McpExecutorService ? executor : tool),
  );
  const moduleRef = { resolve } as unknown as ModuleRef;
  const pingService = {
    configure: jest.fn(),
    registerConnection: jest.fn(),
    removeConnection: jest.fn(),
    getActiveConnectionsInfo: jest.fn(),
  };

  const Controller = createSseController('sse', 'messages', '/api');
  const controller = new Controller(
    { name: 'ranch', version: '1' } as never,
    moduleRef,
    pingService as never,
  );

  const transport = { handlePostMessage: jest.fn(() => Promise.resolve()) };
  const mcpServer = { server: {} };
  const open = () => {
    controller.transports.set(SESSION, transport as never);
    controller.mcpServers.set(SESSION, mcpServer as never);
  };

  const response = () => {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status: jest.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      json: jest.fn((body: unknown) => {
        res.body = body;
        return res;
      }),
    };
    return res;
  };
  const request = (sessionId?: string) =>
    ({
      query: sessionId ? { sessionId } : {},
      url: '/api/messages',
      user: { sub: 'agent:agent-ranch', email: '', roles: ['owner'] },
    }) as unknown as Request;

  const send = async (req: Request, body: unknown) => {
    const res = response();
    await controller.messages(req, res as unknown as Response, body);
    return res;
  };

  return {
    controller,
    tool,
    executor,
    resolve,
    transport,
    mcpServer,
    open,
    request,
    send,
  };
}

const CALL = {
  jsonrpc: '2.0',
  id: 7,
  method: 'tools/call',
  params: { name: 'restart_agent', arguments: { id: 'agent-ranch' } },
};

describe('SSE messages route', () => {
  it('answers 404 "Unknown session" for a session it does not hold, and runs nothing', async () => {
    const { send, request, resolve, tool, executor, transport } = harness();

    const res = await send(request('session-of-nobody'), CALL);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Unknown session' });
    // Not the executor, and not a tool: nothing was resolved at all.
    expect(resolve).not.toHaveBeenCalled();
    expect(executor.registerRequestHandlers).not.toHaveBeenCalled();
    expect(transport.handlePostMessage).not.toHaveBeenCalled();
    expect(tool.restart).not.toHaveBeenCalled();
  });

  it('answers 400 without a session id, and runs nothing', async () => {
    const { send, request, open, resolve, tool } = harness();
    open();

    const res = await send(request(), CALL);

    expect(res.statusCode).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
    expect(tool.restart).not.toHaveBeenCalled();
  });

  it('a tools/call on a session it holds goes to the executor’s handlers through the transport', async () => {
    const h = harness();
    h.open();
    const req = h.request(SESSION);

    const res = await h.send(req, CALL);

    // The handlers are registered for this very request, on this session's
    // server, before the message is handed over.
    expect(h.executor.registerRequestHandlers).toHaveBeenCalledWith(
      h.mcpServer,
      req,
    );
    expect(h.transport.handlePostMessage).toHaveBeenCalledWith(
      req,
      res,
      JSON.stringify(CALL),
    );
    expect(
      h.executor.registerRequestHandlers.mock.invocationCallOrder[0],
    ).toBeLessThan(h.transport.handlePostMessage.mock.invocationCallOrder[0]);
    // The executor is the only thing the route resolves: never a tool.
    expect(h.resolve.mock.calls.map((call) => call[0])).toEqual([
      McpExecutorService,
    ]);
    expect(h.tool.restart).not.toHaveBeenCalled();
    // The transport answers; the route writes nothing of its own.
    expect(res.json).not.toHaveBeenCalled();
  });

  it('a session that closes while the executor is resolved is still not a reason to run the tool directly', async () => {
    const h = harness();
    h.open();
    h.resolve.mockImplementationOnce((token: unknown) => {
      // The client went away: what the cleanup of the SSE route does.
      h.controller.transports.delete(SESSION);
      h.controller.mcpServers.delete(SESSION);
      return Promise.resolve(
        token === McpExecutorService ? h.executor : h.tool,
      );
    });

    const res = await h.send(h.request(SESSION), CALL);

    expect(h.transport.handlePostMessage).toHaveBeenCalledTimes(1);
    expect(h.resolve.mock.calls.map((call) => call[0])).toEqual([
      McpExecutorService,
    ]);
    expect(h.tool.restart).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('holds no tool registry to look a tool up in', () => {
    const { controller } = harness();
    expect(controller).not.toHaveProperty('toolRegistry');
  });

  it('a transport that fails is a 500, with no tool run on the way out', async () => {
    const h = harness();
    h.open();
    h.transport.handlePostMessage.mockRejectedValueOnce(
      new Error('SSE connection not established'),
    );

    const res = await h.send(h.request(SESSION), CALL);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to process MCP request' });
    expect(h.tool.restart).not.toHaveBeenCalled();
  });
});
