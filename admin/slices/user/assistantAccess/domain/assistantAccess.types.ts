// What the Ranch assistant offers people, as the management console sees it
// (CLEAN-240). Envelope-free; the data layer maps the API's DTOs onto these.

export const ASSISTANT_LEVELS = ['basic', 'standard', 'full'] as const;
export type AssistantLevel = (typeof ASSISTANT_LEVELS)[number];
export type AssistantLevelOrCustom = AssistantLevel | 'custom';

/** The roles a setting exists for. The Owner always has everything. */
export const ASSISTANT_ROLES = ['Admin', 'User'] as const;
export type AssistantRole = (typeof ASSISTANT_ROLES)[number];
export type PersonRole = 'Owner' | AssistantRole;

/** A setting as it applies to a role or to one person. */
export interface IAssistantResolved {
  enabled: boolean;
  level: AssistantLevelOrCustom;
  /** For a custom pick that happens to equal a level. */
  matchesLevel: AssistantLevel | null;
  /** The role, the account's own exception, or `owner`. */
  source: 'owner' | 'role' | 'account';
  /** Abilities offered, of those the role's console can do at all. */
  offered: number;
  available: number;
  /** Sent back with a change; a stale one is refused. */
  version: string | null;
}

/** A custom pick: what is on, and what appeared since it was saved. */
export interface IAssistantPick {
  on: string[];
  new: string[];
}

export interface IAssistantRoleData extends IAssistantResolved {
  pick: IAssistantPick | null;
  /** Accounts of the role that follow it. */
  accounts: number;
}

export interface IAssistantAccountData extends IAssistantResolved {
  userId: string;
  role: PersonRole;
  pick: IAssistantPick | null;
  /** What the account would get without its own setting. */
  roleSetting: IAssistantResolved | null;
  /** Whether the signed-in person may change it. */
  editable: boolean;
  /** For an Admin: the abilities they may hand out. null ⇒ no such limit. */
  ceiling: string[] | null;
}

export interface IAssistantException {
  userId: string;
  name: string;
  email: string;
  role: PersonRole;
  resolved: IAssistantResolved;
  updatedBy: string | null;
  updatedAt: string | null;
  /** The pick holds abilities the account's present role cannot have. */
  reducedByRole: boolean;
}

export interface IAssistantOverview {
  /** null while the installation has no assistant. */
  assistant: { id: string; name: string } | null;
  roles: Record<AssistantRole, IAssistantRoleData>;
  exceptions: IAssistantException[];
}

/** One thing the assistant can do for a person. */
export interface IAbility {
  name: string;
  title: string;
  area: string;
  effect: 'read' | 'write';
  destructive: boolean;
  /** The lowest role whose console can do this. */
  minRole: PersonRole;
  /** The levels it belongs to, lowest first. */
  levels: AssistantLevel[];
}

export interface IAbilityArea {
  key: string;
  title: string;
  order: number;
  abilities: IAbility[];
}

export interface IAssistantCatalog {
  areas: IAbilityArea[];
  /** What the assistant needs to talk at all. No setting governs these. */
  alwaysOn: IAbility[];
}

/** What a change asks for. What is left out stays as it is. */
export interface ISetAssistantInput {
  enabled?: boolean;
  level?: AssistantLevelOrCustom;
  /** Only with `level: 'custom'`. */
  on?: string[];
  version?: string | null;
}

/** A refusal from the API, in its own words, with what it is about. */
export class AssistantAccessRefusal extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number | null,
    /** The ability names the refusal names, when it names any. */
    readonly names: string[] = [],
  ) {
    super(message);
    this.name = 'AssistantAccessRefusal';
  }
}
