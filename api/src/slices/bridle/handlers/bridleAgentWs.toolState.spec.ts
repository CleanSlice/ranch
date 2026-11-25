import { Socket } from 'socket.io';
import { BridleAgentWsHandler } from './bridleAgentWs.handler';

/**
 * The `tool_state` socket event (CLEAN-245): the service judges the report,
 * the hub is told the one word that came out of it. What a valid report is
 * belongs to toolState.spec.ts.
 */

function makeHandler(opts: { owns?: boolean } = {}) {
  const hub = {
    isAgentSocket: jest.fn(() => opts.owns ?? true),
    registerAgent: jest.fn(),
    setAgentTools: jest.fn(),
  };
  const toolState = { accept: jest.fn(() => 'limited' as const) };
  const handler = new BridleAgentWsHandler(
    hub as never,
    { get: () => 'key' } as never,
    {} as never,
    {} as never,
    {} as never,
    toolState as never,
  );
  const client = {
    id: 'socket-1',
    data: { agentId: 'agent-1' },
  } as unknown as Socket;
  return { handler, client, hub, toolState };
}

describe('BridleAgentWsHandler — tool_state', () => {
  it('hands the report to the service and its summary to the hub', () => {
    const { handler, client, hub, toolState } = makeHandler();
    const report = { phase: 'limited', servers: [] };

    handler.handleToolState(client, report);

    expect(toolState.accept).toHaveBeenCalledWith('agent-1', report);
    expect(hub.setAgentTools).toHaveBeenCalledWith(
      'agent-1',
      'socket-1',
      'limited',
    );
  });

  it('drops a report from a socket the hub no longer counts as the agent', () => {
    const { handler, client, hub, toolState } = makeHandler({ owns: false });

    handler.handleToolState(client, { phase: 'limited', servers: [] });

    expect(toolState.accept).not.toHaveBeenCalled();
    expect(hub.setAgentTools).not.toHaveBeenCalled();
  });

  it('drops a report from a socket that never said which agent it is', () => {
    const { handler, hub, toolState } = makeHandler();
    const stranger = { id: 'socket-9', data: {} } as unknown as Socket;

    handler.handleToolState(stranger, { phase: 'limited', servers: [] });

    expect(toolState.accept).not.toHaveBeenCalled();
    expect(hub.setAgentTools).not.toHaveBeenCalled();
  });
});
