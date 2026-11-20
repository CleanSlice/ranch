// What the Ranch assistant offers the signed-in person (CLEAN-240), as this
// console sees it. Their own level and how much of each area it covers;
// nothing about anybody else, and nothing here is edited in this console —
// the settings live in the management console.

export type AssistantLevelTypes = 'owner' | 'basic' | 'standard' | 'full' | 'custom';

export interface IAssistantAreaCount {
  key: string;
  title: string;
  /** Abilities the person has, of those their role could have. */
  offered: number;
  available: number;
}

export interface IMyAssistantAccess {
  enabled: boolean;
  level: AssistantLevelTypes;
  areas: IAssistantAreaCount[];
}
