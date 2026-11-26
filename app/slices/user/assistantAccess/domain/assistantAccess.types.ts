// What the Ranch assistant offers the signed-in person (CLEAN-240), as this
// console sees it. Their own level and, area by area, the abilities of their
// role by title (CLEAN-257); nothing about anybody else, and nothing here is
// edited in this console — the settings live in the management console.

export type AssistantLevelTypes = 'owner' | 'basic' | 'standard' | 'full' | 'custom';

/** How one ability of the person's role stands for them. */
export type AssistantAbilityStateTypes =
  | 'included'
  | 'own_agents_only'
  | 'not_included';

/** The order a card lists them in: theirs, theirs on own agents, not theirs. */
export const ASSISTANT_ABILITY_STATES: readonly AssistantAbilityStateTypes[] = [
  'included',
  'own_agents_only',
  'not_included',
];

export interface IAssistantAbility {
  name: string;
  /** From the server, shown as received: never translated. */
  title: string;
  state: AssistantAbilityStateTypes;
}

export interface IAssistantAreaCount {
  key: string;
  title: string;
  /** Abilities the person has, of those their role could have. */
  offered: number;
  available: number;
  /**
   * Every ability of the person's role here, in the order of
   * `ASSISTANT_ABILITY_STATES`. Empty from an API that sends counts only.
   */
  abilities: IAssistantAbility[];
}

export interface IMyAssistantAccess {
  enabled: boolean;
  level: AssistantLevelTypes;
  areas: IAssistantAreaCount[];
}
