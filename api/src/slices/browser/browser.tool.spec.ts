import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { BrowserTool } from './browser.tool';
import { MCP_TOOL_METADATA_KEY, toolAudienceOf } from '#/mcp/decorators';
import type { ToolMetadata } from '#/mcp/decorators';
import { asGuest, asPerson, asTrustedAgent } from '#/mcp/testing';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * The browser tools act for the person the call is made for. CLEAN-109 added
 * the confirmation gate on the two that interrupt a session; CLEAN-232 took
 * the `userId` argument away, because it was whatever the model wrote: any
 * agent runtime could open, reset or list the sessions of any user it named.
 */
const harness = () => {
  const gateway = {
    openSession: jest.fn(async () => ({ sessionId: 's', vncUrl: 'vnc://x' })),
    closeSession: jest.fn(async () => undefined),
    resetSession: jest.fn(async () => ({ cdpUrl: 'ws://fresh' })),
    mintVncUrl: jest.fn(async () => 'vnc://login'),
    setStatus: jest.fn(async () => ({ id: 's', status: 'idle' })),
    findAll: jest.fn(async () => []),
  };
  const tool = new BrowserTool(gateway as never);
  return { tool, gateway };
};

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

/** A plain agent runtime answering the signed-in person «u». */
const forUser = () =>
  asPerson(request([UserRoleTypes.Agent]), UserRoleTypes.User, 'u');

const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

describe('BrowserTool — destructive tools require confirm', () => {
  it('closes a session once confirmed', async () => {
    const { tool, gateway } = harness();
    const result = await tool.close(
      { sessionId: 's', confirm: true },
      null,
      forUser(),
    );
    expect(gateway.closeSession).toHaveBeenCalledWith('u', 's');
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('"sessionId": "s"');
  });

  it('refuses to close without confirm and names the session', async () => {
    const { tool, gateway } = harness();
    const result = await tool.close({ sessionId: 's' }, null, forUser());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('close the browser session s');
    expect(textOf(result)).toContain('confirm: true');
    expect(gateway.closeSession).not.toHaveBeenCalled();
  });

  it('resets a session once confirmed and refuses otherwise', async () => {
    const { tool, gateway } = harness();
    expect(
      (await tool.reset({ sessionId: 's' }, null, forUser())).isError,
    ).toBe(true);
    expect(gateway.resetSession).not.toHaveBeenCalled();
    const result = await tool.reset(
      { sessionId: 's', confirm: true },
      null,
      forUser(),
    );
    expect(gateway.resetSession).toHaveBeenCalledWith('u', 's');
    expect(textOf(result)).toContain('ws://fresh');
  });
});

describe('BrowserTool — whose sessions (CLEAN-232)', () => {
  it('is a person tool', () => {
    expect(toolAudienceOf(BrowserTool, undefined)).toBe('person');
  });

  it('acts for the person the call is made for, in every tool', async () => {
    const { tool, gateway } = harness();

    await tool.open(
      {
        accountKey: 'instagram:miybot',
        loginUrl: 'https://example.test/login',
      },
      null,
      forUser(),
    );
    await tool.loginUrl({ sessionId: 's' }, null, forUser());
    await tool.setStatus(
      { sessionId: 's', status: 'idle' as never },
      null,
      forUser(),
    );
    await tool.list({}, null, forUser());

    expect(gateway.openSession).toHaveBeenCalledWith(
      'u',
      'instagram:miybot',
      'https://example.test/login',
    );
    expect(gateway.mintVncUrl).toHaveBeenCalledWith('u', 's');
    expect(gateway.setStatus).toHaveBeenCalledWith('u', 's', 'idle');
    expect(gateway.findAll).toHaveBeenCalledWith({
      userId: 'u',
      status: undefined,
    });
  });

  it('ignores a userId the model still sends: nobody acts for another account', async () => {
    const { tool, gateway } = harness();

    await tool.list({ userId: 'user-owner' } as never, null, forUser());
    await tool.reset(
      { userId: 'user-owner', sessionId: 's', confirm: true } as never,
      null,
      forUser(),
    );

    expect(gateway.findAll).toHaveBeenCalledWith({
      userId: 'u',
      status: undefined,
    });
    expect(gateway.resetSession).toHaveBeenCalledWith('u', 's');
  });

  it('refuses every tool when no person is behind the call, and touches nothing', async () => {
    const { tool, gateway } = harness();
    const callers = [
      () => request([UserRoleTypes.Agent]),
      () => asGuest(request([UserRoleTypes.Owner])),
      // The agent acting for itself has no browser sessions of its own,
      // the Ranch admin agent included.
      () => asTrustedAgent(request([UserRoleTypes.Owner])),
    ];

    for (const caller of callers) {
      const calls = [
        () => tool.open({ accountKey: 'paypal:main' }, null, caller()),
        () => tool.close({ sessionId: 's', confirm: true }, null, caller()),
        () => tool.reset({ sessionId: 's', confirm: true }, null, caller()),
        () => tool.loginUrl({ sessionId: 's' }, null, caller()),
        () =>
          tool.setStatus(
            { sessionId: 's', status: 'idle' as never },
            null,
            caller(),
          ),
        () => tool.list({}, null, caller()),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toThrow(
          new ForbiddenException('This needs a signed-in person.'),
        );
      }
    }
    for (const fn of Object.values(gateway)) expect(fn).not.toHaveBeenCalled();
  });

  it('no tool declares a userId parameter any more', () => {
    const proto = BrowserTool.prototype as unknown as Record<string, object>;
    const methods = ['open', 'close', 'reset', 'loginUrl', 'setStatus', 'list'];
    for (const method of methods) {
      const metadata = Reflect.getMetadata(
        MCP_TOOL_METADATA_KEY,
        proto[method],
      ) as ToolMetadata;
      const shape = (
        metadata.parameters as unknown as { shape: Record<string, unknown> }
      ).shape;
      expect(Object.keys(shape)).not.toContain('userId');
    }
  });
});
