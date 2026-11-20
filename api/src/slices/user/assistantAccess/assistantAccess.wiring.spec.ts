import { AssistantAccessWiring } from './assistantAccess.wiring';
import { UserRoleTypes } from '#/user/user/domain/user.types';

/**
 * The settings mean nothing until two seams are told about them. This is the
 * spec that fails if the introduction is ever dropped: the tables would
 * still be written, and nobody would be limited by them.
 */
describe('AssistantAccessWiring', () => {
  const build = (assistant: { id: string; name: string } | null) => {
    const access = { attachAssistant: jest.fn(), onRemoved: jest.fn() };
    const catalog = { addPolicy: jest.fn() };
    const service = {
      assistant: jest.fn(async () => assistant),
      grantFor: jest.fn(async () => ({
        enabled: false,
        names: new Set(),
        level: 'basic',
      })),
      removeUser: jest.fn(async () => undefined),
    };
    const policy = { allowedToolsFor: jest.fn() };
    new AssistantAccessWiring(
      access as never,
      catalog as never,
      service as never,
      policy as never,
    ).onModuleInit();
    return { access, catalog, service, policy };
  };

  it('registers the tool policy with the catalogue', () => {
    const { catalog, policy } = build({ id: 'r', name: 'Rancher' });
    expect(catalog.addPolicy).toHaveBeenCalledWith(policy);
  });

  it('hands the access lists the switch of each person', async () => {
    const { access, service } = build({ id: 'r', name: 'Rancher' });
    const provider = access.attachAssistant.mock.calls[0][0];
    expect(await provider.assistantId()).toBe('r');
    expect(
      await provider.forPerson({ userId: 'u1', role: UserRoleTypes.User }),
    ).toEqual({ id: 'r', enabled: false });
    expect(service.grantFor).toHaveBeenCalledWith({
      kind: 'person',
      userId: 'u1',
      role: UserRoleTypes.User,
    });
  });

  it('says there is no switch while there is no assistant', async () => {
    const { access } = build(null);
    const provider = access.attachAssistant.mock.calls[0][0];
    expect(await provider.assistantId()).toBeNull();
    expect(
      await provider.forPerson({ userId: 'u1', role: UserRoleTypes.User }),
    ).toBeNull();
  });

  it('removes an account’s exception with the account', () => {
    const { access, service } = build({ id: 'r', name: 'Rancher' });
    access.onRemoved.mock.calls[0][0]('u1');
    expect(service.removeUser).toHaveBeenCalledWith('u1');
  });
});
