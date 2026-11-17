import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { IUserGateway } from './domain';
import { refuseUserEdit, USER_EDIT_REFUSALS, UserRoleTypes } from './domain';
import { ROLES_METADATA_KEY } from '../auth/guards';
import { UserController } from './user.controller';

/**
 * `PUT /users/:id` (CLEAN-232). The route admits an Admin, and until now an
 * Admin could set the Owner's password, or another Admin's, and sign in as
 * them. The rule: the Owner changes anyone; an Admin changes Users and their
 * own name, email and password; never the Owner's account or another
 * Admin's.
 */

const at = new Date('2026-09-17T10:00:00.000Z');
const account = (id: string, role: UserRoleTypes) => ({
  id,
  name: id,
  email: `${id}@ranch.test`,
  role,
  status: 'active' as const,
  createdAt: at,
  updatedAt: at,
});
const owner = account('user-owner', UserRoleTypes.Owner);
const ada = account('user-ada', UserRoleTypes.Admin);
const bob = account('user-bob', UserRoleTypes.Admin);
const jane = account('user-jane', UserRoleTypes.User);
const ROWS = [owner, ada, bob, jane];

function make() {
  const users = {
    findById: jest.fn((id: string) =>
      Promise.resolve(ROWS.find((u) => u.id === id) ?? null),
    ),
    update: jest.fn((id: string, patch: object) =>
      Promise.resolve({ ...ROWS.find((u) => u.id === id), ...patch }),
    ),
    create: jest.fn((data: object) => Promise.resolve({ ...jane, ...data })),
  };
  return {
    controller: new UserController(users as unknown as IUserGateway),
    users,
  };
}

const as = (who: { id: string; role: UserRoleTypes }) =>
  ({ user: { sub: who.id, email: '', roles: [who.role] } }) as never;

const refusalOf = async (run: Promise<unknown>): Promise<string | null> => {
  try {
    await run;
    return null;
  } catch (e) {
    if (e instanceof ForbiddenException) return e.message;
    throw e;
  }
};

describe('PUT /users/:id — who may change which account', () => {
  it('an Admin changes a User, status included', async () => {
    const { controller, users } = make();
    await controller.update(
      jane.id,
      { name: 'Jane D.', status: 'disabled' },
      as(ada),
    );
    expect(users.update).toHaveBeenCalledWith(jane.id, {
      name: 'Jane D.',
      status: 'disabled',
    });
  });

  it.each([
    ['the password', { password: 'a-new-password' }],
    ['the email', { email: 'taken@over.test' }],
    ['the name', { name: 'Somebody Else' }],
    ['the status', { status: 'disabled' as const }],
  ])('an Admin does not change %s of the Owner', async (_what, dto) => {
    const { controller, users } = make();
    expect(await refusalOf(controller.update(owner.id, dto, as(ada)))).toBe(
      USER_EDIT_REFUSALS.owner,
    );
    expect(users.update).not.toHaveBeenCalled();
  });

  it('an Admin does not change another Admin', async () => {
    const { controller, users } = make();
    expect(
      await refusalOf(
        controller.update(bob.id, { password: 'a-new-password' }, as(ada)),
      ),
    ).toBe(USER_EDIT_REFUSALS.otherAdmin);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('an Admin changes their own name, email and password', async () => {
    const { controller, users } = make();
    const dto = {
      name: 'Ada L.',
      email: 'ada@new.test',
      password: 'a-new-password',
    };
    await controller.update(ada.id, dto, as(ada));
    expect(users.update).toHaveBeenCalledWith(ada.id, dto);
  });

  it('but not their own status', async () => {
    const { controller, users } = make();
    expect(
      await refusalOf(
        controller.update(ada.id, { status: 'disabled' }, as(ada)),
      ),
    ).toBe(USER_EDIT_REFUSALS.ownStatus);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('the Owner changes anyone', async () => {
    const { controller, users } = make();
    await controller.update(bob.id, { password: 'a-new-password' }, as(owner));
    await controller.update(jane.id, { status: 'disabled' }, as(owner));
    await controller.update(owner.id, { name: 'The Boss' }, as(owner));
    expect(users.update).toHaveBeenCalledTimes(3);
  });

  it('nobody changes the Owner’s status, the Owner included: the older rule stands', async () => {
    const { controller, users } = make();
    expect(
      await refusalOf(
        controller.update(owner.id, { status: 'disabled' }, as(owner)),
      ),
    ).toBe('The Owner account status cannot be changed');
    expect(users.update).not.toHaveBeenCalled();
  });

  it('answers 404 for an account that does not exist, before any rule', async () => {
    const { controller } = make();
    await expect(
      controller.update('user-nope', { name: 'X Y' }, as(ada)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a bearer that is not a person changes nobody', async () => {
    const { controller, users } = make();
    for (const req of [
      { user: { sub: 'agent:ranch', roles: [UserRoleTypes.Owner] } },
      { user: { sub: 'user-x', roles: [] } },
      {},
    ]) {
      expect(
        await refusalOf(
          controller.update(jane.id, { name: 'X Y' }, req as never),
        ),
      ).toBe(USER_EDIT_REFUSALS.notAllowed);
    }
    expect(users.update).not.toHaveBeenCalled();
  });

  it('each refusal is a sentence a person can act on', () => {
    for (const sentence of Object.values(USER_EDIT_REFUSALS)) {
      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence.length).toBeGreaterThan(30);
    }
  });
});

describe('the roles on the user routes', () => {
  const rolesOf = (handler: keyof UserController) =>
    (Reflect.getMetadata(
      ROLES_METADATA_KEY,
      UserController.prototype[handler],
    ) as UserRoleTypes[] | undefined) ??
    (Reflect.getMetadata(
      ROLES_METADATA_KEY,
      UserController,
    ) as UserRoleTypes[]);

  it('Admin for the list, the account and its creation and update; Owner for role and removal', () => {
    expect(rolesOf('findAll')).toEqual([UserRoleTypes.Admin]);
    expect(rolesOf('findById')).toEqual([UserRoleTypes.Admin]);
    expect(rolesOf('create')).toEqual([UserRoleTypes.Admin]);
    expect(rolesOf('update')).toEqual([UserRoleTypes.Admin]);
    expect(rolesOf('updateRole')).toEqual([UserRoleTypes.Owner]);
    expect(rolesOf('remove')).toEqual([UserRoleTypes.Owner]);
  });

  it('POST /users lets an Admin create an Admin, as before: only Owner is not assignable', async () => {
    const { controller, users } = make();
    await controller.create({
      name: 'New Admin',
      email: 'new@ranch.test',
      password: 'a-new-password',
      role: UserRoleTypes.Admin,
    });
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRoleTypes.Admin }),
    );
  });
});

describe('refuseUserEdit', () => {
  const person = (who: { id: string; role: UserRoleTypes }) =>
    ({ kind: 'person', userId: who.id, role: who.role }) as const;

  it('a trusted party edits anyone', () => {
    for (const target of ROWS) {
      expect(
        refuseUserEdit({ kind: 'trusted' }, target, ['password']),
      ).toBeNull();
    }
  });

  it('a User edits nobody here, themselves included', () => {
    for (const target of ROWS) {
      expect(refuseUserEdit(person(jane), target, ['name'])).toBe(
        USER_EDIT_REFUSALS.notAllowed,
      );
    }
  });

  it('an account with a role that is not a person’s is not an Admin’s to change', () => {
    expect(
      refuseUserEdit(
        person(ada),
        { id: 'user-odd', role: UserRoleTypes.Agent },
        ['name'],
      ),
    ).toBe(USER_EDIT_REFUSALS.notAllowed);
  });

  it('an Admin’s own account is theirs whatever the fields, except the status', () => {
    expect(
      refuseUserEdit(person(ada), ada, ['name', 'email', 'password']),
    ).toBeNull();
    expect(refuseUserEdit(person(ada), ada, [])).toBeNull();
    expect(refuseUserEdit(person(ada), ada, ['name', 'status'])).toBe(
      USER_EDIT_REFUSALS.ownStatus,
    );
  });
});
