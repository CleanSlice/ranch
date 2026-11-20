import { UserRoleTypes } from '#/user/user/domain/user.types';
import type { AssistantLevel } from './assistantLevels';

// Assistant access domain contract (CLEAN-240). Pure types and constants: no
// Prisma, no DTOs, no Nest.

/** The roles a setting can be made for. The Owner always has everything. */
export const ASSISTANT_ROLES = [
  UserRoleTypes.Admin,
  UserRoleTypes.User,
] as const;
export type AssistantRole = (typeof ASSISTANT_ROLES)[number];

export function isAssistantRole(value: unknown): value is AssistantRole {
  return (ASSISTANT_ROLES as readonly unknown[]).includes(value);
}

/** A level, or the Owner's own pick of abilities. */
export type AssistantLevelOrCustom = AssistantLevel | 'custom';

/**
 * A custom pick as stored. `on` is what is offered. `known` is every governed
 * tool name that existed when it was saved: a name in the catalogue and not
 * here appeared later, and is off until someone has looked at it.
 */
export interface IAssistantCustom {
  on: string[];
  known: string[];
}

/** One stored setting: a role's, or an account's exception. */
export interface IAssistantSettingData {
  enabled: boolean;
  level: AssistantLevelOrCustom;
  custom: IAssistantCustom | null;
  updatedById: string | null;
  updatedAt: Date | null;
}

export interface IAssistantAccountData extends IAssistantSettingData {
  userId: string;
}

/** What an editor asks for. `on` only with `level: 'custom'`. */
export interface IAssistantSettingInput {
  enabled?: boolean;
  level?: AssistantLevelOrCustom;
  on?: string[];
  /** The `version` the editor last saw; a mismatch is refused. */
  version?: string | null;
}

/** With nothing configured (FR-003, FR-009). */
export const ASSISTANT_ROLE_DEFAULTS: Record<
  AssistantRole,
  Pick<IAssistantSettingData, 'enabled' | 'level'>
> = {
  [UserRoleTypes.Admin]: { enabled: true, level: 'full' },
  [UserRoleTypes.User]: { enabled: true, level: 'basic' },
};

/** Where a person's setting comes from. */
export type AssistantSourceTypes = 'owner' | 'role' | 'account';

/** A setting as it applies to one role or one person. */
export interface IAssistantResolved {
  enabled: boolean;
  level: AssistantLevelOrCustom;
  /** For a custom pick that happens to equal a level. */
  matchesLevel: AssistantLevel | null;
  source: AssistantSourceTypes;
  /** Abilities offered, of those the role's console can do at all. */
  offered: number;
  available: number;
  version: string | null;
}

/** A custom pick, for whoever edits it. */
export interface IAssistantPick {
  on: string[];
  /** In the catalogue, not yet seen by whoever saved the pick. */
  new: string[];
}

/** What the tool policy needs: is it on, and which names. */
export interface IAssistantGrant {
  enabled: boolean;
  /** null ⇒ no setting applies to this caller (Owner, trusted, not a person). */
  names: ReadonlySet<string> | null;
  level: AssistantLevelOrCustom | 'owner';
}

export interface IAssistantPerson {
  userId: string;
  role: UserRoleTypes;
}

/** Who is changing a setting. A trusted party acts as the Owner. */
export type IAssistantEditor =
  | { kind: 'person'; userId: string; role: UserRoleTypes }
  | { kind: 'trusted' };

export const AssistantAccessErrorCodes = {
  UserNotFound: 'USER_NOT_FOUND',
  NotAllowed: 'ASSISTANT_ACCESS_NOT_ALLOWED',
  BadRole: 'ASSISTANT_ROLE_UNKNOWN',
  BadLevel: 'ASSISTANT_LEVEL_UNKNOWN',
  UnknownAbility: 'UNKNOWN_ABILITY',
  AboveRole: 'ABOVE_THE_ROLE',
  AboveYourOwn: 'ABOVE_YOUR_OWN',
  Stale: 'ASSISTANT_ACCESS_STALE',
} as const;
export type AssistantAccessErrorCodeTypes =
  (typeof AssistantAccessErrorCodes)[keyof typeof AssistantAccessErrorCodes];

export const ASSISTANT_ACCESS_REFUSALS = {
  owner:
    'The Owner always has the assistant with everything. There is nothing ' +
    'to change on the Owner account.',
  self: 'You cannot change what the assistant offers you. Ask the Owner.',
  otherAdmin:
    'An Admin cannot change the assistant for another Admin. Ask the Owner.',
  roles: 'Only the Owner decides what a whole role gets from the assistant.',
  notAllowed:
    'Your account cannot change who uses the assistant. Ask the Owner.',
  aboveYourOwn:
    'This would give more than the assistant offers you. Ask the Owner.',
  aboveRole: 'These abilities are above what this role can do in the console.',
  unknownAbility: 'These are not abilities the assistant has.',
  stale:
    'This setting was changed by someone else in the meantime. Reload and ' +
    'try again.',
  userNotFound: 'User not found',
} as const;

export class AssistantAccessError extends Error {
  constructor(
    readonly code: AssistantAccessErrorCodeTypes,
    message: string,
    /** The ability names the refusal is about, when it is about names. */
    readonly names?: string[],
  ) {
    super(message);
    this.name = 'AssistantAccessError';
  }
}
