import { UserRoleTypes } from './user.types';

/**
 * Who is changing an account: a signed-in person, or a party trusted with
 * Owner power (the Ranch admin agent acting for itself).
 */
export type IUserEditor =
  | { kind: 'person'; userId: string; role: UserRoleTypes }
  | { kind: 'trusted' };

/** The fields `PUT /users/:id` and `update_user` can change. */
export type UserEditFields = 'name' | 'email' | 'password' | 'status';

export const USER_EDIT_REFUSALS = {
  owner:
    'Only the Owner can change the Owner account. Ask the Owner to do it ' +
    'from their own session.',
  otherAdmin:
    "An Admin cannot change another Admin's account. Ask the Owner to do it.",
  ownStatus:
    'You cannot change the status of your own account. Ask the Owner, or ' +
    'another administrator, to do it.',
  notAllowed: 'Your account cannot change other accounts.',
} as const;

/**
 * May this editor change that account (CLEAN-232)? Returns the sentence to
 * refuse with, or null when the change may go ahead.
 *
 *  - The Owner, and a trusted party, may edit anyone.
 *  - An Admin may edit an account whose role is User, and the name, email
 *    and password of their own account. Never the Owner's account and never
 *    another Admin's: with a password change on either, an Admin would sign
 *    in as that person and hold their role.
 *  - Nobody else edits accounts here.
 *
 * One rule for `PUT /users/:id` and the `update_user` tool. It adds to the
 * older rule that the Owner's status is never changed, which both callers
 * still apply themselves.
 */
export function refuseUserEdit(
  editor: IUserEditor,
  target: { id: string; role: UserRoleTypes },
  fields: readonly UserEditFields[],
): string | null {
  if (editor.kind === 'trusted') return null;
  if (editor.role === UserRoleTypes.Owner) return null;
  if (editor.role !== UserRoleTypes.Admin) {
    return USER_EDIT_REFUSALS.notAllowed;
  }
  if (target.id === editor.userId) {
    return fields.includes('status') ? USER_EDIT_REFUSALS.ownStatus : null;
  }
  if (target.role === UserRoleTypes.Owner) return USER_EDIT_REFUSALS.owner;
  if (target.role === UserRoleTypes.Admin) return USER_EDIT_REFUSALS.otherAdmin;
  if (target.role === UserRoleTypes.User) return null;
  return USER_EDIT_REFUSALS.notAllowed;
}
