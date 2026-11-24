import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { IUserGateway } from '#/user/user/domain/user.gateway';
import { UserRoleTypes } from '#/user/user/domain/user.types';
import { MemoryAgentAccessGateway } from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { BrowserExtensionController } from './browser.extension.controller';
import type { IBrowserGateway } from './domain';

/**
 * The extension's token lives up to a year (CLEAN-231). What it was minted
 * with was true on that day; `import-state` asks again on every use, with
 * the minting account as the database has it now: still there, not disabled,
 * and still reaching the agent the token names.
 */

interface IAccount {
  id: string;
  role: UserRoleTypes;
  status: string;
}

function harness(accounts: IAccount[]) {
  const lists = new MemoryAgentAccessGateway(['agent-a', 'agent-b']);
  const users = {
    findById: (id: string) =>
      Promise.resolve(accounts.find((a) => a.id === id) ?? null),
  } as unknown as IUserGateway;
  const access = new AgentAccessService(lists, users);
  const importStorageState = jest
    .fn()
    .mockResolvedValue({ path: 'agents/agent-a/state.json', cookies: 2 });
  const gateway = { importStorageState } as unknown as IBrowserGateway;
  // The token's claims, as `jwt.verify` hands them back.
  let claims: Record<string, unknown> = {};
  const jwt = {
    verify: () => claims,
    sign: (body: Record<string, unknown>) => JSON.stringify(body),
    decode: () => ({ exp: 1 }),
  } as unknown as JwtService;
  const bridle = { notifyBrowserStateImported: jest.fn() };
  const controller = new BrowserExtensionController(
    gateway,
    jwt,
    access,
    bridle as never,
  );
  const importAs = (sub: string, agentId = 'agent-a') => {
    claims = { sub, agentId, userId: 'admin', scope: 'browser:cookies' };
    return controller.importState(
      { profile: 'default', cookies: [], origins: [] } as never,
      'Bearer extension-token',
    );
  };
  return { lists, importAs, importStorageState, accounts, controller, bridle };
}

const admin = (): IAccount => ({
  id: 'user-admin',
  role: UserRoleTypes.Admin,
  status: 'active',
});

describe('BrowserExtensionController.importState', () => {
  it('imports for an account that still reaches the agent', async () => {
    const { importAs, importStorageState } = harness([admin()]);
    await expect(importAs('user-admin')).resolves.toEqual({
      ok: true,
      path: 'agents/agent-a/state.json',
      cookies: 2,
    });
    expect(importStorageState).toHaveBeenCalledTimes(1);
  });

  it('tells the running agent to pull the file it just got (CLEAN-243)', async () => {
    const { importAs, bridle } = harness([admin()]);
    await importAs('user-admin');
    expect(bridle.notifyBrowserStateImported).toHaveBeenCalledWith(
      'agent-a',
      'agents/agent-a/state.json',
    );
  });

  it('404 once the agent is taken away from the account that minted the token', async () => {
    const { importAs, importStorageState, lists } = harness([admin()]);
    await importAs('user-admin');
    // The Owner denies the agent after the token was minted.
    lists.seed('user-admin', false, [{ agentId: 'agent-a', list: 'denied' }]);

    await expect(importAs('user-admin')).rejects.toThrow(
      new NotFoundException('Agent not found'),
    );
    expect(importStorageState).toHaveBeenCalledTimes(1);
    // The same token family still works for an agent they do reach.
    await expect(importAs('user-admin', 'agent-b')).resolves.toBeDefined();
  });

  it('reads the role now: an Admin who was limited since is held to the lists', async () => {
    const { importAs, lists } = harness([admin()]);
    lists.seed('user-admin', true, [{ agentId: 'agent-b', list: 'allowed' }]);
    await expect(importAs('user-admin', 'agent-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(importAs('user-admin', 'agent-b')).resolves.toBeDefined();
  });

  it('404 for an account that was deleted, whatever it reached', async () => {
    const { importAs, importStorageState } = harness([]);
    await expect(importAs('user-admin')).rejects.toThrow(
      new NotFoundException('Agent not found'),
    );
    expect(importStorageState).not.toHaveBeenCalled();
  });

  it('404 for an account that was disabled', async () => {
    const { importAs, importStorageState } = harness([
      { ...admin(), status: 'disabled' },
    ]);
    await expect(importAs('user-admin')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(importStorageState).not.toHaveBeenCalled();
  });

  it('404 for an agent that no longer exists, in the same words', async () => {
    const { importAs } = harness([
      { id: 'user-owner', role: UserRoleTypes.Owner, status: 'active' },
    ]);
    await expect(importAs('user-owner', 'agent-gone')).rejects.toThrow(
      new NotFoundException('Agent not found'),
    );
    // The Owner is never restricted, for an agent that is there.
    await expect(importAs('user-owner', 'agent-a')).resolves.toBeDefined();
  });

  it('a subject that is no account at all imports nothing', async () => {
    const { importAs } = harness([admin()]);
    await expect(importAs('agent:agent-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('still refuses a token that is not the extension’s before anything is asked', async () => {
    const lists = new MemoryAgentAccessGateway(['agent-a']);
    const access = new AgentAccessService(lists, {
      findById: () => Promise.reject(new Error('must not be asked')),
    } as unknown as IUserGateway);
    const controller = new BrowserExtensionController(
      {} as IBrowserGateway,
      {
        verify: () => ({ sub: 'user-admin', agentId: 'agent-a', userId: 'x' }),
      } as unknown as JwtService,
      access,
      { notifyBrowserStateImported: jest.fn() } as never,
    );
    await expect(
      controller.importState({} as never, 'Bearer console-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// Whose browser state the cookies land in (CLEAN-243). The runtime files a
// person's state under their chat identity — `admin` for the Owner, the
// account id for anyone else (CLEAN-236) — and the extension used to send
// `admin` for everybody, into the Owner's file.
describe('BrowserExtensionController — whose cookies', () => {
  const owner = (): IAccount => ({
    id: 'user-owner',
    role: UserRoleTypes.Owner,
    status: 'active',
  });

  it('an import an Admin makes lands in their own file, whatever the old token says', async () => {
    const { importAs, importStorageState } = harness([admin()]);
    // `importAs` signs the claims the old extension minted: userId `admin`.
    await importAs('user-admin');
    expect(importStorageState.mock.calls[0][2]).toBe('user-admin');
  });

  it("the Owner's import lands in the Owner's file, `admin`", async () => {
    const { importAs, importStorageState } = harness([owner()]);
    await importAs('user-owner');
    expect(importStorageState.mock.calls[0][2]).toBe('admin');
  });

  it('a minted token names the caller, not what the body says', async () => {
    const { controller } = harness([admin()]);
    const mint = (user: Record<string, unknown>) =>
      controller
        .issueToken({ agentId: 'agent-a', userId: 'admin' } as never, {
          user,
        } as never)
        .then((r) => JSON.parse(r.token) as Record<string, unknown>);
    await expect(
      mint({ sub: 'user-admin', roles: [UserRoleTypes.Admin] }),
    ).resolves.toMatchObject({ sub: 'user-admin', userId: 'user-admin' });
    await expect(
      mint({ sub: 'user-owner', roles: [UserRoleTypes.Owner] }),
    ).resolves.toMatchObject({ userId: 'admin' });
    // A token that proves no person mints nothing.
    await expect(mint({ roles: [UserRoleTypes.User] })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
