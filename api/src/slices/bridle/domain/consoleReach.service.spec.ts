import { UserRoleTypes } from '#/user/user/domain';
import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';
import { ConsoleReachService } from './consoleReach.service';
import type { IConsoleSession } from './chatIdentity';

/**
 * CLEAN-236. Reading another person's conversation with an agent is
 * supervision of that agent. It used to come with the client id every Owner
 * and Admin shared; it is now asked of the manage rule, for the person
 * behind a console session and for nobody else.
 */
describe('ConsoleReachService.manages', () => {
  const agents = {
    findById: (id: string) =>
      Promise.resolve(
        id === 'ghost'
          ? null
          : { id, isAdmin: id === 'agent-ranch', createdById: null },
      ),
  };
  const service = new ConsoleReachService(
    {} as never,
    agents as never,
    permissionOver(agents),
  );
  const session = (role: UserRoleTypes): IConsoleSession => ({
    userId: 'user-1',
    sid: 'session-1',
    role,
  });

  it('the Owner manages every agent, the Ranch admin agent included', async () => {
    const owner = session(UserRoleTypes.Owner);
    expect(await service.manages(owner, 'agent-a')).toBe(true);
    expect(await service.manages(owner, 'agent-ranch')).toBe(true);
  });

  it('an Admin manages an ordinary agent, and not the Ranch admin agent', async () => {
    const admin = session(UserRoleTypes.Admin);
    expect(await service.manages(admin, 'agent-a')).toBe(true);
    expect(await service.manages(admin, 'agent-ranch')).toBe(false);
  });

  it('a User manages nothing they did not create', async () => {
    expect(await service.manages(session(UserRoleTypes.User), 'agent-a')).toBe(
      false,
    );
  });

  it('nobody manages an agent that does not exist', async () => {
    expect(await service.manages(session(UserRoleTypes.Owner), 'ghost')).toBe(
      false,
    );
  });

  it('no console session, no management: an embed token, a share visitor, nobody', async () => {
    expect(await service.manages(null, 'agent-a')).toBe(false);
    expect(await service.manages(undefined, 'agent-a')).toBe(false);
  });
});
