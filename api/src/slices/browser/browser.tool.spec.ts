import { BrowserTool } from './browser.tool';

/**
 * The browser tools act for the calling user; what CLEAN-109 added is the
 * confirmation gate on the two that interrupt a session.
 */
const harness = () => {
  const gateway = {
    openSession: jest.fn(),
    closeSession: jest.fn(async () => undefined),
    resetSession: jest.fn(async () => ({ cdpUrl: 'ws://fresh' })),
    mintVncUrl: jest.fn(),
    setStatus: jest.fn(),
    listSessions: jest.fn(),
  };
  const tool = new BrowserTool(gateway as never);
  return { tool, gateway };
};

const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

describe('BrowserTool — destructive tools require confirm', () => {
  it('closes a session once confirmed', async () => {
    const { tool, gateway } = harness();
    const result = await tool.close({ userId: 'u', sessionId: 's', confirm: true });
    expect(gateway.closeSession).toHaveBeenCalledWith('u', 's');
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('"sessionId": "s"');
  });

  it('refuses to close without confirm and names the session', async () => {
    const { tool, gateway } = harness();
    const result = await tool.close({ userId: 'u', sessionId: 's' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('close the browser session s');
    expect(textOf(result)).toContain('confirm: true');
    expect(gateway.closeSession).not.toHaveBeenCalled();
  });

  it('resets a session once confirmed and refuses otherwise', async () => {
    const { tool, gateway } = harness();
    expect(
      (await tool.reset({ userId: 'u', sessionId: 's' })).isError,
    ).toBe(true);
    expect(gateway.resetSession).not.toHaveBeenCalled();
    const result = await tool.reset({ userId: 'u', sessionId: 's', confirm: true });
    expect(gateway.resetSession).toHaveBeenCalledWith('u', 's');
    expect(textOf(result)).toContain('ws://fresh');
  });
});
