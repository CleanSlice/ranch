import type { IAgentData } from '#agent/domain';
import type { ITemplateData } from '#template/domain';

// Domain types for the Rancher bootstrap status.

/** A setting whose live value is not the one the assistant is deployed from. */
export interface IAssistantSettingDrift {
  group: string;
  name: string;
  /** 'changed' | 'added' | 'removed' — never the values. */
  change: string;
  changedByName: string | null;
  changedAt: string;
  /** Names this exact state; sent back with the apply. Holds no value. */
  version: string;
}

export interface IRancherStatus {
  hasLlm: boolean;
  hasS3: boolean;
  template: ITemplateData | null;
  admin: IAgentData | null;
}
