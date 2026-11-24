import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { IUserGateway } from '#/user/user/domain/user.gateway';
import { UserRoleTypes } from '#/user/user/domain/user.types';
import { MemoryAgentAccessGateway } from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { IntegrationExtensionController } from './integration.extension.controller';
import type { IntegrationService } from './domain/integration.service';

/**
 * The integration token lives up to a year (CLEAN-243). `import-state` asks
 * again on every use, as the browser import does: the minting account must
 * still be there, not disabled, and still allowed to mint the token.
 */
function harness(accounts: { id: string; role: UserRoleTypes; status: string }[]) {
  const users = {
    findById: (id: string) => Promise.resolve(accounts.find((a) => a.id === id) ?? null),
  } as unknown as IUserGateway;
  const access = new AgentAccessService(new MemoryAgentAccessGateway([]), users);
  const connectAndImport = jest
    .fn()
    .mockResolvedValue({ id: 'acc-1', service: 'instagram', accountKey: 'main' });
  const service = { connectAndImport } as unknown as IntegrationService;
  let sub = '';
  const jwt = {
    verify: () => ({ sub, scope: 'integration:cookies' }),
  } as unknown as JwtService;
  const controller = new IntegrationExtensionController(service, jwt, access);
  const importAs = (who: string) => {
    sub = who;
    return controller.importState(
      { service: 'instagram', accountKey: 'main', cookies: [], origins: [] } as never,
      'Bearer extension-token',
    );
  };
  return { importAs, connectAndImport };
}

describe('IntegrationExtensionController.importState', () => {
  it('imports for an Admin who still has the account', async () => {
    const { importAs, connectAndImport } = harness([
      { id: 'u-admin', role: UserRoleTypes.Admin, status: 'active' },
    ]);
    await expect(importAs('u-admin')).resolves.toMatchObject({ ok: true });
    expect(connectAndImport).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['deleted', []],
    ['disabled', [{ id: 'u-admin', role: UserRoleTypes.Admin, status: 'disabled' }]],
    ['demoted to User', [{ id: 'u-admin', role: UserRoleTypes.User, status: 'active' }]],
  ])('refuses an account that was %s since the token was minted', async (_, accounts) => {
    const { importAs, connectAndImport } = harness(accounts);
    await expect(importAs('u-admin')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(connectAndImport).not.toHaveBeenCalled();
  });
});
