import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ROLES_METADATA_KEY } from '#/user/auth/guards/roles.decorator';
import { UserRoleTypes } from '#/user/user/domain';
import { AssistantAccessController } from './assistantAccess.controller';
import {
  AssistantAccessError,
  AssistantAccessErrorCodes,
  type AssistantAccessService,
} from './domain';

const as = (sub: string, role: string) =>
  ({ user: { sub, email: '', roles: [role] } }) as never;

function build(
  overrides: Partial<Record<keyof AssistantAccessService, jest.Mock>> = {},
) {
  const service = {
    overview: jest.fn(async () => ({
      assistant: null,
      roles: {},
      exceptions: [],
    })),
    catalog: jest.fn(() => ({ areas: [], alwaysOn: [] })),
    setRole: jest.fn(async () => ({ level: 'standard' })),
    accountView: jest.fn(async () => ({ userId: 'u1' })),
    setAccount: jest.fn(async () => ({ userId: 'u1' })),
    resetAccount: jest.fn(async () => ({ userId: 'u1' })),
    myAccess: jest.fn(async () => ({
      enabled: true,
      level: 'basic',
      matchesLevel: null,
      areas: [{ key: 'agents', title: 'Agents', offered: 2, available: 4 }],
      leftOut: [
        { name: 'restart_agent', title: 'Restart an agent', area: 'agents' },
      ],
    })),
    ...overrides,
  };
  return {
    service,
    controller: new AssistantAccessController(
      service as unknown as AssistantAccessService,
    ),
  };
}

const rolesOf = (method: keyof AssistantAccessController) =>
  Reflect.getMetadata(
    ROLES_METADATA_KEY,
    AssistantAccessController.prototype[method] as object,
  ) as UserRoleTypes[];

describe('AssistantAccessController: who may call what', () => {
  it('the overview and the role settings are the Owner’s', () => {
    expect(rolesOf('overview')).toEqual([UserRoleTypes.Owner]);
    expect(rolesOf('setRole')).toEqual([UserRoleTypes.Owner]);
  });

  it('account settings and the catalogue need an Admin', () => {
    for (const method of [
      'account',
      'setAccount',
      'resetAccount',
      'catalog',
    ] as const) {
      expect(rolesOf(method)).toEqual([UserRoleTypes.Admin]);
    }
  });

  it('everybody signed in may ask about themselves', () => {
    expect(rolesOf('mine')).toEqual([UserRoleTypes.User]);
  });

  it('every route states a role', () => {
    const handlers = Object.getOwnPropertyNames(
      AssistantAccessController.prototype,
    ).filter((name) => name !== 'constructor');
    for (const name of handlers) {
      expect(rolesOf(name as never)?.length).toBeGreaterThan(0);
    }
  });
});

describe('AssistantAccessController: the editor is the person on the token', () => {
  it('passes who is asking, with the role the token carries', async () => {
    const { controller, service } = build();
    await controller.setAccount(
      'u1',
      { level: 'basic' },
      as('admin-1', 'Admin'),
    );
    expect(service.setAccount).toHaveBeenCalledWith(
      { kind: 'person', userId: 'admin-1', role: UserRoleTypes.Admin },
      'u1',
      { level: 'basic' },
    );
  });

  it('an agent token is nobody who may edit', async () => {
    const { controller, service } = build();
    await controller.account('u1', as('agent:r', 'Owner'));
    expect(service.accountView).toHaveBeenCalledWith(
      { kind: 'person', userId: 'agent:r', role: UserRoleTypes.Agent },
      'u1',
    );
  });
});

describe('AssistantAccessController: refusals', () => {
  const failing = (code: string, names?: string[]) =>
    build({
      setAccount: jest.fn(async () => {
        throw new AssistantAccessError(code as never, 'because', names);
      }),
    }).controller.setAccount('u1', {}, as('owner', 'Owner'));

  it.each([
    [AssistantAccessErrorCodes.UserNotFound, NotFoundException],
    [AssistantAccessErrorCodes.NotAllowed, ForbiddenException],
    [AssistantAccessErrorCodes.BadRole, BadRequestException],
    [AssistantAccessErrorCodes.BadLevel, BadRequestException],
    [AssistantAccessErrorCodes.Stale, ConflictException],
    [AssistantAccessErrorCodes.UnknownAbility, UnprocessableEntityException],
    [AssistantAccessErrorCodes.AboveRole, UnprocessableEntityException],
    [AssistantAccessErrorCodes.AboveYourOwn, UnprocessableEntityException],
  ])('%s', async (code, expected) => {
    await expect(failing(code)).rejects.toBeInstanceOf(expected);
  });

  it('says which abilities a refusal is about', async () => {
    const err = (await failing(AssistantAccessErrorCodes.AboveYourOwn, [
      'restart_agent',
    ]).catch(
      (e: UnprocessableEntityException) => e,
    )) as UnprocessableEntityException;
    expect(err.getResponse()).toEqual({
      code: 'ABOVE_YOUR_OWN',
      message: 'because',
      names: ['restart_agent'],
    });
  });

  it('does not turn something else into a refusal', async () => {
    const { controller } = build({
      overview: jest.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(controller.overview(as('owner', 'Owner'))).rejects.toThrow(
      'db down',
    );
  });
});

describe('AssistantAccessController: what a person is told about themselves', () => {
  it('level and counts, not the names of what was left out', async () => {
    const { controller, service } = build();
    const mine = await controller.mine(as('user-1', 'User'));
    expect(mine).toEqual({
      enabled: true,
      level: 'basic',
      matchesLevel: null,
      areas: [{ key: 'agents', title: 'Agents', offered: 2, available: 4 }],
    });
    expect(service.myAccess).toHaveBeenCalledWith({
      kind: 'person',
      userId: 'user-1',
      role: UserRoleTypes.User,
    });
  });
});
