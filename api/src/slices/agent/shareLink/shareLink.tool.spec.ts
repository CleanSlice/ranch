import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { ShareLinkTool, resolveAppOrigin } from './shareLink.tool';
import type { IShareLinkState, ShareLinkService } from './domain';
import type { IAgentGateway } from '#/agent/agent/domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * A share link is a credential anyone can use, so the checks that matter are
 * about who can mint one and what leaves the tool: a plain agent gets
 * nothing, a destructive call waits for the person, the link comes back as
 * the URL the person will hand out and never as a bare token, and a dead
 * link shows no token at all.
 */
const TOKEN = 'sl_mCV1jC5G3nre2dz7hEx7Y8PnbwfyZTVaTKJ8L2SAaDU';
const APP_URL = 'https://ranch.example';

const active = (overrides: Partial<IShareLinkState> = {}): IShareLinkState => ({
  active: true,
  token: TOKEN,
  createdAt: '2026-09-17T10:00:00.000Z',
  revokedAt: null,
  rotatedAt: null,
  rotationCount: 0,
  ...overrides,
});

const revoked = (): IShareLinkState =>
  active({ active: false, token: null, revokedAt: '2026-09-18T10:00:00.000Z' });

const neverShared = (): IShareLinkState => ({
  active: false,
  token: null,
  createdAt: null,
  revokedAt: null,
  rotatedAt: null,
  rotationCount: 0,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

interface Harness {
  tool: ShareLinkTool;
  shareLinks: {
    getState: jest.Mock;
    share: jest.Mock;
    regenerate: jest.Mock;
    revoke: jest.Mock;
  };
  agents: { findById: jest.Mock };
}

function harness(): Harness {
  const shareLinks = {
    getState: jest.fn().mockResolvedValue(active()),
    share: jest.fn().mockResolvedValue(active()),
    regenerate: jest.fn().mockResolvedValue(
      active({
        token: 'sl_NEWTOKENxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        rotatedAt: '2026-09-18T10:00:00.000Z',
        rotationCount: 1,
      }),
    ),
    revoke: jest.fn().mockResolvedValue(revoked()),
  };
  const agents = {
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'agent-a', name: 'Support Bot' }),
  };
  const tool = new ShareLinkTool(
    shareLinks as unknown as ShareLinkService,
    agents as unknown as IAgentGateway,
  );
  return { tool, shareLinks, agents };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

const ENV_KEYS = ['PUBLIC_APP_URL', 'ADMIN_URL', 'ADMIN_BASE_URL'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.PUBLIC_APP_URL = APP_URL;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('ShareLinkTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a plain agent even by name, before touching the service', async () => {
    const { tool, shareLinks } = harness();
    await expect(
      tool.createShareLink({ agentId: 'agent-a' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.getShareLink({ agentId: 'agent-a' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(shareLinks.share).not.toHaveBeenCalled();
    expect(shareLinks.getState).not.toHaveBeenCalled();
  });

  it('refuses to record a write with no token subject, as the controller does', async () => {
    const { tool, shareLinks } = harness();
    const noSub = {
      user: { email: '', roles: [UserRoleTypes.Owner] },
    } as unknown as Request;
    await expect(
      tool.createShareLink({ agentId: 'agent-a' }, null, noSub),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(shareLinks.share).not.toHaveBeenCalled();
  });
});

describe('ShareLinkTool — reading', () => {
  it('returns the link as the URL a visitor opens, never as a bare token', async () => {
    const { tool, shareLinks } = harness();
    const text = textOf(
      await tool.getShareLink({ agentId: 'agent-a' }, null, operator()),
    );
    expect(shareLinks.getState).toHaveBeenCalledWith('agent-a');
    expect(text).toContain('"active": true');
    expect(text).toContain(`"shareUrl": "${APP_URL}/share?token=${TOKEN}"`);
    expect(text).toContain('Support Bot');
    expect(text).not.toContain('"token"');
  });

  it('shows a never-shared agent as inactive with no link', async () => {
    const { tool, shareLinks } = harness();
    shareLinks.getState.mockResolvedValue(neverShared());
    const text = textOf(
      await tool.getShareLink({ agentId: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('"active": false');
    expect(text).toContain('"shareUrl": null');
    expect(text).not.toContain('sl_');
  });

  it('hands back the path with a note when no app origin is known', async () => {
    delete process.env.PUBLIC_APP_URL;
    const { tool } = harness();
    const text = textOf(
      await tool.getShareLink({ agentId: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('"shareUrl": null');
    expect(text).toContain(`"sharePath": "/share?token=${TOKEN}"`);
    expect(text).toContain('PUBLIC_APP_URL');
  });

  it('names the next move when the agent does not exist', async () => {
    const { tool, shareLinks, agents } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.getShareLink({ agentId: 'agent-x' }, null, operator()),
    );
    expect(text).toContain('Agent agent-x not found');
    expect(text).toContain('list_agents');
    expect(shareLinks.getState).not.toHaveBeenCalled();
  });

  it('turns a 404 from the service into the same not-found answer', async () => {
    const { tool, shareLinks } = harness();
    shareLinks.getState.mockRejectedValue(
      new NotFoundException('Agent not found'),
    );
    const text = textOf(
      await tool.getShareLink({ agentId: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('not found');
    expect(text).toContain('list_agents');
  });
});

describe('ShareLinkTool — creating', () => {
  it('shares as the calling subject and returns the URL', async () => {
    const { tool, shareLinks } = harness();
    const text = textOf(
      await tool.createShareLink({ agentId: 'agent-a' }, null, operator()),
    );
    expect(shareLinks.share).toHaveBeenCalledWith('agent-a', 'agent:agent-ops');
    expect(text).toContain(`${APP_URL}/share?token=${TOKEN}`);
    expect(text).not.toContain('"token"');
  });

  it('does not share an agent that does not exist', async () => {
    const { tool, shareLinks, agents } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.createShareLink({ agentId: 'agent-x' }, null, operator()),
    );
    expect(text).toContain('not found');
    expect(shareLinks.share).not.toHaveBeenCalled();
  });
});

describe('ShareLinkTool — regenerating', () => {
  it('refuses without the confirmation argument and mints nothing', async () => {
    const { tool, shareLinks } = harness();
    const result = await tool.regenerateShareLink(
      { agentId: 'agent-a' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm: true');
    expect(textOf(result)).toContain('«Support Bot»');
    expect(shareLinks.regenerate).not.toHaveBeenCalled();
  });

  it('reports a missing agent before asking for a confirmation', async () => {
    const { tool, shareLinks, agents } = harness();
    agents.findById.mockResolvedValue(null);
    const result = await tool.regenerateShareLink(
      { agentId: 'agent-x' },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('not found');
    expect(shareLinks.regenerate).not.toHaveBeenCalled();
  });

  it('rotates once confirmed and returns only the new link', async () => {
    const { tool, shareLinks } = harness();
    const text = textOf(
      await tool.regenerateShareLink(
        { agentId: 'agent-a', confirm: true },
        null,
        operator(),
      ),
    );
    expect(shareLinks.regenerate).toHaveBeenCalledWith(
      'agent-a',
      'agent:agent-ops',
    );
    expect(text).toContain('sl_NEWTOKEN');
    expect(text).not.toContain(TOKEN);
    expect(text).toContain('"rotationCount": 1');
    expect(text).toContain('previous link no longer works');
  });
});

describe('ShareLinkTool — revoking', () => {
  it('refuses without the confirmation argument and revokes nothing', async () => {
    const { tool, shareLinks } = harness();
    const result = await tool.revokeShareLink(
      { agentId: 'agent-a' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm: true');
    expect(shareLinks.revoke).not.toHaveBeenCalled();
  });

  it('revokes once confirmed and shows no token afterwards', async () => {
    const { tool, shareLinks } = harness();
    const text = textOf(
      await tool.revokeShareLink(
        { agentId: 'agent-a', confirm: true },
        null,
        operator(),
      ),
    );
    expect(shareLinks.revoke).toHaveBeenCalledWith(
      'agent-a',
      'agent:agent-ops',
    );
    expect(text).toContain('"active": false');
    expect(text).toContain('"shareUrl": null');
    expect(text).toContain('create_share_link');
    expect(text).not.toContain('sl_');
  });

  it('says so when there was nothing to revoke', async () => {
    const { tool, shareLinks } = harness();
    shareLinks.revoke.mockResolvedValue(neverShared());
    const text = textOf(
      await tool.revokeShareLink(
        { agentId: 'agent-a', confirm: true },
        null,
        operator(),
      ),
    );
    expect(text).toContain('was not shared');
  });

  it('does not revoke for an agent that does not exist', async () => {
    const { tool, shareLinks, agents } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.revokeShareLink(
        { agentId: 'agent-x', confirm: true },
        null,
        operator(),
      ),
    );
    expect(text).toContain('not found');
    expect(shareLinks.revoke).not.toHaveBeenCalled();
  });
});

describe('resolveAppOrigin — the same rule the admin console uses', () => {
  it('prefers an explicit PUBLIC_APP_URL, keeping a sub-path and dropping the slash', () => {
    expect(
      resolveAppOrigin({ PUBLIC_APP_URL: 'https://ranch.example/app/' }),
    ).toBe('https://ranch.example/app');
  });

  it('ignores a PUBLIC_APP_URL that is not http(s)', () => {
    expect(resolveAppOrigin({ PUBLIC_APP_URL: 'ftp://ranch.example' })).toBe(
      null,
    );
  });

  it('derives <domain> from admin.<domain>', () => {
    expect(resolveAppOrigin({ ADMIN_URL: 'https://admin.ranch.example' })).toBe(
      'https://ranch.example',
    );
  });

  it('points a local admin at the app dev port', () => {
    expect(resolveAppOrigin({ ADMIN_URL: 'http://localhost:3001' })).toBe(
      'http://localhost:3000',
    );
  });

  it('guesses nothing for an admin host it cannot read', () => {
    expect(resolveAppOrigin({ ADMIN_URL: 'https://console.example' })).toBe(
      null,
    );
    expect(resolveAppOrigin({ ADMIN_URL: 'https://admin.com' })).toBe(null);
    expect(resolveAppOrigin({})).toBe(null);
  });
});
